#define _GNU_SOURCE
#include <node_api.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/file.h>
#include <sys/syscall.h>
#include <sys/random.h>
#include <poll.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <time.h>
#include <stdbool.h>

#ifndef __linux__
#error Linux with per-message credentials and pidfs is required
#endif
#ifndef SO_PASSPIDFD
#define SO_PASSPIDFD 76
#endif
#ifndef SCM_PIDFD
#define SCM_PIDFD 4
#endif
#define PIDFS_MAGIC 0x50494446
#define LIMIT 16384
#define SOCKET_PATH "/run/cop-account-safety/driver.sock"
#define PEER_PATH "/run/cop-account-safety/public/server-peer-v1.bin"
#define LOCK_PATH "/run/cop-account-safety/server.lock"
static const char hello[] = "{\"contractVersion\":\"cop-root-peer-v1\"}\n";
typedef struct { uint64_t dev, ino; uint32_t uid, gid; } Peer;
typedef struct { int fd, pidfd, lockfd, listener, busy; } Handle;
static const napi_type_tag handle_tag={0xa7334208c0814be7ULL,0x9a291decf7dc541bULL};
typedef struct {
  napi_env env; napi_deferred deferred; napi_async_work work; napi_ref ref;
  Handle *handle; int mode, ok, connection, pidfd;
  unsigned char input[LIMIT], output[LIMIT+1]; size_t input_len, output_len; Peer peer;
} Work;

static int root(void) { return getuid()==0 && geteuid()==0; }
static int custody_directory(const char *path) {
  char parent[256]; struct stat s;
  if(path[0]!='/' || strlen(path)>=sizeof(parent)) return 0;
  strcpy(parent,path);
  for(;;) {
    if(lstat(parent,&s)!=0 || !S_ISDIR(s.st_mode) || s.st_uid!=0 || (s.st_mode&022)) return 0;
    if(!strcmp(parent,"/")) return 1;
    char *slash=strrchr(parent,'/'); if(slash==parent) parent[1]=0; else *slash=0;
  }
}
static int identity(int fd, Peer *p) {
  struct stat s; struct statfs fs;
  if(fstat(fd,&s)!=0 || fstatfs(fd,&fs)!=0 || fs.f_type!=PIDFS_MAGIC || !s.st_ino) return 0;
  p->dev=(uint64_t)s.st_dev; p->ino=(uint64_t)s.st_ino; return 1;
}
static int same_peer(const Peer *a,const Peer *b) {
  return a->dev==b->dev && a->ino==b->ino && a->uid==b->uid && a->gid==b->gid;
}
static void put64(unsigned char *p,uint64_t n) { for(int i=0;i<8;i++) p[i]=(unsigned char)(n>>(8*i)); }
static uint64_t get64(const unsigned char *p) { uint64_t n=0; for(int i=0;i<8;i++) n|=(uint64_t)p[i]<<(8*i); return n; }
static void put32(unsigned char *p,uint32_t n) { for(int i=0;i<4;i++) p[i]=(unsigned char)(n>>(8*i)); }
static uint32_t get32(const unsigned char *p) { uint32_t n=0; for(int i=0;i<4;i++) n|=(uint32_t)p[i]<<(8*i); return n; }
static int read_peer(Peer *peer) {
  if(!custody_directory("/run/cop-account-safety/public")) return 0;
  int fd=open(PEER_PATH,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK); if(fd<0) return 0;
  struct stat before,after; unsigned char bytes[33];
  int ok=fstat(fd,&before)==0 && S_ISREG(before.st_mode) && before.st_uid==0 && before.st_nlink==1 &&
    !(before.st_mode&022) && before.st_size==32;
  ssize_t count=ok?read(fd,bytes,sizeof(bytes)):-1;
  ok=ok && count==32 && fstat(fd,&after)==0 && after.st_nlink==1 && before.st_dev==after.st_dev && before.st_ino==after.st_ino &&
    before.st_size==after.st_size && before.st_mtim.tv_sec==after.st_mtim.tv_sec && before.st_mtim.tv_nsec==after.st_mtim.tv_nsec &&
    before.st_ctim.tv_sec==after.st_ctim.tv_sec && before.st_ctim.tv_nsec==after.st_ctim.tv_nsec && !memcmp(bytes,"COPPID01",8);
  close(fd); if(!ok) return 0;
  peer->dev=get64(bytes+8); peer->ino=get64(bytes+16); peer->uid=get32(bytes+24); peer->gid=get32(bytes+28);
  return peer->ino!=0 && peer->uid==0;
}
static int publish_peer(const Peer *peer) {
  unsigned char bytes[32]; memcpy(bytes,"COPPID01",8); put64(bytes+8,peer->dev); put64(bytes+16,peer->ino);
  put32(bytes+24,peer->uid); put32(bytes+28,peer->gid);
  uint64_t nonce; if(getrandom(&nonce,sizeof(nonce),0)!=(ssize_t)sizeof(nonce)) return 0;
  char path[256]; snprintf(path,sizeof(path),"/run/cop-account-safety/public/.peer-%016llx",(unsigned long long)nonce);
  int fd=open(path,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0644); if(fd<0) return 0;
  int ok=write(fd,bytes,sizeof(bytes))==(ssize_t)sizeof(bytes) && fsync(fd)==0;
  close(fd); if(ok) ok=rename(path,PEER_PATH)==0;
  if(!ok) { unlink(path); return 0; }
  fd=open("/run/cop-account-safety/public",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  if(fd<0) return 0;
  ok=fsync(fd)==0; close(fd); return ok;
}
static int options(int fd) {
  int one=1;
  return setsockopt(fd,SOL_SOCKET,SO_PASSCRED,&one,sizeof(one))==0 &&
    setsockopt(fd,SOL_SOCKET,SO_PASSPIDFD,&one,sizeof(one))==0;
}
static int64_t now_ms(void) { struct timespec t; if(clock_gettime(CLOCK_MONOTONIC,&t)!=0) return -1; return t.tv_sec*1000LL+t.tv_nsec/1000000; }
static int wait_fd(int fd,short events,int64_t until) {
  for(;;) {
    int64_t remaining=until-now_ms(); if(remaining<=0 || remaining>10000) return 0;
    struct pollfd p={fd,events,0}; int result=poll(&p,1,(int)remaining);
    if(result<0 && errno==EINTR) continue;
    return result>0 && (p.revents&events) && !(p.revents&POLLNVAL);
  }
}
static int packet_send(int fd,const unsigned char *bytes,size_t count,int64_t until) {
  if(!wait_fd(fd,POLLOUT,until)) return 0;
  ssize_t n; do n=send(fd,bytes,count,MSG_NOSIGNAL|MSG_DONTWAIT); while(n<0 && errno==EINTR);
  return n==(ssize_t)count;
}
/** Close every delivered descriptor, including unexpected SCM_RIGHTS, on all
 * paths. The accepted pidfd stays owned by the connection until reply/close. */
static int packet_recv(int fd,unsigned char *bytes,size_t *count,Peer *peer,int *kept_pidfd,int64_t until) {
  if(!wait_fd(fd,POLLIN,until)) return 0;
  union { struct cmsghdr alignment; unsigned char bytes[CMSG_SPACE(sizeof(struct ucred))+CMSG_SPACE(64*sizeof(int))+CMSG_SPACE(sizeof(int))]; } ancillary;
  memset(&ancillary,0,sizeof(ancillary)); struct iovec iov={bytes,LIMIT+1};
  struct msghdr message={0}; message.msg_iov=&iov; message.msg_iovlen=1;
  message.msg_control=ancillary.bytes; message.msg_controllen=sizeof(ancillary.bytes);
  ssize_t n; do n=recvmsg(fd,&message,MSG_CMSG_CLOEXEC|MSG_DONTWAIT); while(n<0 && errno==EINTR);
  if(n<0) return 0;
  int ok=n>0 && n<=LIMIT && !(message.msg_flags&(MSG_TRUNC|MSG_CTRUNC));
  int credentials=0,pidfds=0,pidfd=-1; struct ucred credential={0};
  for(struct cmsghdr *c=CMSG_FIRSTHDR(&message);c;c=CMSG_NXTHDR(&message,c)) {
    size_t offset=(size_t)((unsigned char *)c-ancillary.bytes);
    if(c->cmsg_len<CMSG_LEN(0) || c->cmsg_len>message.msg_controllen-offset) { ok=0; break; }
    size_t data=c->cmsg_len-CMSG_LEN(0);
    if(c->cmsg_level==SOL_SOCKET && c->cmsg_type==SCM_CREDENTIALS) {
      credentials++; if(data==sizeof(credential)) memcpy(&credential,CMSG_DATA(c),data); else ok=0;
    } else if(c->cmsg_level==SOL_SOCKET && (c->cmsg_type==SCM_PIDFD || c->cmsg_type==SCM_RIGHTS)) {
      size_t descriptors=data/sizeof(int);
      if(data%sizeof(int)) ok=0;
      for(size_t i=0;i<descriptors;i++) {
        int passed; memcpy(&passed,(unsigned char *)CMSG_DATA(c)+i*sizeof(int),sizeof(passed));
        if(c->cmsg_type==SCM_PIDFD && descriptors==1 && ++pidfds==1) pidfd=passed;
        else { close(passed); ok=0; }
      }
      if(c->cmsg_type==SCM_RIGHTS) ok=0;
    } else ok=0;
  }
  ok=ok && credentials==1 && pidfds==1 && pidfd>=0;
  if(ok) { peer->uid=credential.uid; peer->gid=credential.gid; ok=identity(pidfd,peer); }
  if(!ok) { if(pidfd>=0) close(pidfd); return 0; }
  *count=(size_t)n; *kept_pidfd=pidfd; return 1;
}
static void close_handle(Handle *h) {
  if(h->fd>=0) { close(h->fd); h->fd=-1; }
  if(h->pidfd>=0) { close(h->pidfd); h->pidfd=-1; }
  if(h->listener && h->lockfd>=0) { unlink(SOCKET_PATH); }
  if(h->lockfd>=0) { close(h->lockfd); h->lockfd=-1; }
}
static void finalize(napi_env env,void *data,void *hint) { (void)env; (void)hint; Handle *h=data; close_handle(h); free(h); }
static napi_value error(napi_env env,const char *code) { napi_throw_error(env,code,code); return NULL; }
static napi_value external(napi_env env,int fd,int pidfd,int lockfd,int listener) {
  Handle *h=calloc(1,sizeof(*h)); if(!h) { close(fd); if(pidfd>=0) close(pidfd); if(lockfd>=0) close(lockfd); return error(env,"COP_ROOT_NATIVE_UNAVAILABLE"); }
  h->fd=fd; h->pidfd=pidfd; h->lockfd=lockfd; h->listener=listener;
  napi_value value;
  if(napi_create_object(env,&value)!=napi_ok || napi_wrap(env,value,h,finalize,NULL,NULL)!=napi_ok) {
    close_handle(h); free(h); return NULL;
  }
  if(napi_type_tag_object(env,value,&handle_tag)!=napi_ok) return error(env,"COP_ROOT_NATIVE_UNAVAILABLE");
  return value;
}
static Handle *get_handle(napi_env env,napi_value value) {
  bool matches=false,is_null=false; Handle *handle=NULL; napi_valuetype type; napi_value null_value;
  if(napi_typeof(env,value,&type)!=napi_ok || type!=napi_object) return NULL;
  napi_get_null(env,&null_value); napi_strict_equals(env,value,null_value,&is_null);
  if(is_null) return NULL;
  if(napi_check_object_type_tag(env,value,&handle_tag,&matches)!=napi_ok || !matches ||
    napi_unwrap(env,value,(void **)&handle)!=napi_ok) return NULL;
  return handle;
}
static napi_value peer_value(napi_env env,const Peer *peer) {
  napi_value object,value; char text[32]; napi_create_object(env,&object);
  snprintf(text,sizeof(text),"%llu",(unsigned long long)peer->dev); napi_create_string_utf8(env,text,NAPI_AUTO_LENGTH,&value); napi_set_named_property(env,object,"device",value);
  snprintf(text,sizeof(text),"%llu",(unsigned long long)peer->ino); napi_create_string_utf8(env,text,NAPI_AUTO_LENGTH,&value); napi_set_named_property(env,object,"inode",value);
  napi_create_uint32(env,peer->uid,&value); napi_set_named_property(env,object,"uid",value);
  napi_create_uint32(env,peer->gid,&value); napi_set_named_property(env,object,"gid",value); return object;
}
static void perform(napi_env env,void *data) {
  (void)env; Work *w=data; int64_t until=now_ms()+5000; w->connection=-1; w->pidfd=-1;
  if(w->mode==0) {
    Peer expected,hello_peer; int hello_fd=-1;
    if(!read_peer(&expected) || !custody_directory("/run/cop-account-safety")) return;
    int fd=socket(AF_UNIX,SOCK_SEQPACKET|SOCK_CLOEXEC|SOCK_NONBLOCK,0); if(fd<0) return;
    struct sockaddr_un address={0}; address.sun_family=AF_UNIX; strcpy(address.sun_path,SOCKET_PATH);
    int ok=options(fd) && connect(fd,(struct sockaddr *)&address,sizeof(address))==0;
    size_t n=0;
    if(ok) ok=packet_recv(fd,w->output,&n,&hello_peer,&hello_fd,until) && same_peer(&expected,&hello_peer) &&
      n==sizeof(hello)-1 && !memcmp(w->output,hello,n);
    if(ok) ok=packet_send(fd,w->input,w->input_len,until);
    if(ok) ok=packet_recv(fd,w->output,&w->output_len,&w->peer,&w->pidfd,until) && same_peer(&expected,&w->peer);
    if(hello_fd>=0) close(hello_fd);
    close(fd); w->ok=ok;
  } else if(w->mode==1) {
    if(!wait_fd(w->handle->fd,POLLIN,until)) return;
    int fd=accept4(w->handle->fd,NULL,NULL,SOCK_CLOEXEC|SOCK_NONBLOCK); if(fd<0) return;
    int ok=options(fd) && packet_send(fd,(const unsigned char *)hello,sizeof(hello)-1,until) &&
      packet_recv(fd,w->output,&w->output_len,&w->peer,&w->pidfd,until);
    if(ok) { w->connection=fd; w->ok=1; } else close(fd);
  } else {
    w->ok=packet_send(w->handle->fd,w->input,w->input_len,until); close_handle(w->handle);
  }
}
static void complete(napi_env env,napi_status status,void *data) {
  Work *w=data; napi_value result;
  if(w->handle) w->handle->busy=0;
  if(status==napi_ok && w->ok) {
    if(w->mode==1) {
      napi_create_object(env,&result); napi_value packet,connection,peer=peer_value(env,&w->peer);
      napi_create_buffer_copy(env,w->output_len,w->output,NULL,&packet);
      connection=external(env,w->connection,w->pidfd,-1,0); w->connection=-1; w->pidfd=-1;
      napi_set_named_property(env,result,"packet",packet); napi_set_named_property(env,result,"peer",peer); napi_set_named_property(env,result,"connection",connection);
    } else if(w->mode==0) napi_create_buffer_copy(env,w->output_len,w->output,NULL,&result);
    else napi_get_undefined(env,&result);
    napi_resolve_deferred(env,w->deferred,result);
  } else {
    napi_value message; napi_create_string_utf8(env,"COP_ROOT_NATIVE_UNAVAILABLE",NAPI_AUTO_LENGTH,&message);
    napi_create_error(env,NULL,message,&result); napi_reject_deferred(env,w->deferred,result);
  }
  if(w->connection>=0) close(w->connection);
  if(w->pidfd>=0) close(w->pidfd);
  if(w->ref) napi_delete_reference(env,w->ref);
  napi_delete_async_work(env,w->work);
  memset(w,0,sizeof(*w)); free(w);
}
static napi_value submit(napi_env env,napi_callback_info info,int mode) {
  napi_value args[3]; size_t count=3; napi_get_cb_info(env,info,&count,args,NULL,NULL);
  if(count!=(size_t)(mode==2?2:1)) return error(env,"COP_ROOT_NATIVE_ARGUMENT");
  Work *w=calloc(1,sizeof(*w)); if(!w) return error(env,"COP_ROOT_NATIVE_UNAVAILABLE");
  w->env=env; w->mode=mode; w->connection=-1; w->pidfd=-1;
  if(mode!=0) {
    w->handle=get_handle(env,args[0]);
    if(!root() || !w->handle || w->handle->fd<0 ||
      w->handle->busy || w->handle->listener!=(mode==1)) { free(w); return error(env,"COP_ROOT_NATIVE_ARGUMENT"); }
  }
  if(mode!=1) {
    bool is_buffer=false; unsigned char *bytes=NULL; size_t size=0;
    if(napi_is_buffer(env,args[mode==2?1:0],&is_buffer)!=napi_ok || !is_buffer ||
      napi_get_buffer_info(env,args[mode==2?1:0],(void **)&bytes,&size)!=napi_ok || size<1 || size>LIMIT) {
      free(w); return error(env,"COP_ROOT_NATIVE_ARGUMENT"); }
    memcpy(w->input,bytes,size); w->input_len=size;
  }
  napi_value promise,name; napi_create_promise(env,&w->deferred,&promise); napi_create_string_utf8(env,"cop-root-seqpacket",NAPI_AUTO_LENGTH,&name);
  if(w->handle) { w->handle->busy=1; napi_create_reference(env,args[0],1,&w->ref); }
  napi_status status=napi_create_async_work(env,NULL,name,perform,complete,w,&w->work);
  if(status==napi_ok) status=napi_queue_async_work(env,w->work);
  if(status!=napi_ok) {
    if(w->handle) w->handle->busy=0;
    if(w->ref) napi_delete_reference(env,w->ref);
    if(w->work) napi_delete_async_work(env,w->work);
    free(w); return error(env,"COP_ROOT_NATIVE_UNAVAILABLE");
  }
  return promise;
}
static napi_value exchange(napi_env e,napi_callback_info i) { return submit(e,i,0); }
static napi_value receive_packet(napi_env e,napi_callback_info i) { return submit(e,i,1); }
static napi_value reply(napi_env e,napi_callback_info i) { return submit(e,i,2); }
static napi_value close_js(napi_env env,napi_callback_info info) {
  napi_value arg; size_t count=1; Handle *h=NULL; napi_get_cb_info(env,info,&count,&arg,NULL,NULL);
  if(count==1) h=get_handle(env,arg);
  if(!root() || count!=1 || !h || h->busy) return error(env,"COP_ROOT_NATIVE_ARGUMENT");
  close_handle(h); napi_value result; napi_get_undefined(env,&result); return result;
}
static napi_value inspect_pid(napi_env env,napi_callback_info info) {
  napi_value arg; size_t count=1; uint32_t pid=0; double number=0; napi_get_cb_info(env,info,&count,&arg,NULL,NULL);
  if(!root() || count!=1 || napi_get_value_uint32(env,arg,&pid)!=napi_ok ||
    napi_get_value_double(env,arg,&number)!=napi_ok || pid<1 || number!=(double)pid) return error(env,"COP_ROOT_NATIVE_ARGUMENT");
  int fd=(int)syscall(SYS_pidfd_open,pid,0); Peer peer={0};
  int ok=fd>=0 && identity(fd,&peer); if(fd>=0) close(fd);
  if(!ok) return error(env,"COP_ROOT_NATIVE_UNAVAILABLE");
  napi_value result=peer_value(env,&peer),key; bool deleted;
  napi_create_string_utf8(env,"uid",NAPI_AUTO_LENGTH,&key); napi_delete_property(env,result,key,&deleted);
  napi_create_string_utf8(env,"gid",NAPI_AUTO_LENGTH,&key); napi_delete_property(env,result,key,&deleted);
  return result;
}
/* Unprivileged callers may inspect only their own pidfs identity. UID numbers
 * are intentionally absent: the Root receiver observes them in its namespace. */
static napi_value self_identity(napi_env env,napi_callback_info info) {
  napi_value args[1]; size_t count=1; napi_get_cb_info(env,info,&count,args,NULL,NULL);
  if(count!=0) return error(env,"COP_ROOT_NATIVE_ARGUMENT");
  int fd=(int)syscall(SYS_pidfd_open,getpid(),0); Peer peer={0};
  int ok=fd>=0 && identity(fd,&peer); if(fd>=0) close(fd);
  if(!ok) return error(env,"COP_ROOT_NATIVE_UNAVAILABLE");
  napi_value result=peer_value(env,&peer),key; bool deleted;
  napi_create_string_utf8(env,"uid",NAPI_AUTO_LENGTH,&key); napi_delete_property(env,result,key,&deleted);
  napi_create_string_utf8(env,"gid",NAPI_AUTO_LENGTH,&key); napi_delete_property(env,result,key,&deleted);
  return result;
}
static napi_value listen_js(napi_env env,napi_callback_info info) {
  napi_value args[1]; size_t count=1; napi_get_cb_info(env,info,&count,args,NULL,NULL);
  if(count!=0 || !root() || !custody_directory("/run/cop-account-safety/public")) return error(env,"COP_ROOT_NATIVE_ARGUMENT");
  int lockfd=open(LOCK_PATH,O_RDWR|O_CREAT|O_CLOEXEC|O_NOFOLLOW,0600); struct stat s;
  int ok=lockfd>=0 && fstat(lockfd,&s)==0 && S_ISREG(s.st_mode) && s.st_uid==0 && s.st_nlink==1 && !(s.st_mode&077) && flock(lockfd,LOCK_EX|LOCK_NB)==0;
  if(!ok) { if(lockfd>=0) close(lockfd); return error(env,"COP_ROOT_NATIVE_UNAVAILABLE"); }
  int fd=socket(AF_UNIX,SOCK_SEQPACKET|SOCK_CLOEXEC|SOCK_NONBLOCK,0), pidfd=(int)syscall(SYS_pidfd_open,getpid(),0);
  Peer peer={.uid=getuid(),.gid=getgid()}; ok=fd>=0 && pidfd>=0 && identity(pidfd,&peer) && options(fd);
  if(ok && lstat(SOCKET_PATH,&s)==0) ok=S_ISSOCK(s.st_mode) && s.st_uid==0 && unlink(SOCKET_PATH)==0;
  else if(ok && errno!=ENOENT) ok=0;
  struct sockaddr_un address={0}; address.sun_family=AF_UNIX; strcpy(address.sun_path,SOCKET_PATH);
  if(ok) ok=bind(fd,(struct sockaddr *)&address,sizeof(address))==0 && chmod(SOCKET_PATH,0660)==0 && listen(fd,16)==0 && publish_peer(&peer);
  if(!ok) { if(fd>=0) close(fd); if(pidfd>=0) close(pidfd); close(lockfd); return error(env,"COP_ROOT_NATIVE_UNAVAILABLE"); }
  return external(env,fd,pidfd,lockfd,1);
}
NAPI_MODULE_INIT() {
  napi_property_descriptor methods[]={
    {"exchange",NULL,exchange,NULL,NULL,NULL,napi_default,NULL}, {"listen",NULL,listen_js,NULL,NULL,NULL,napi_default,NULL},
    {"receive",NULL,receive_packet,NULL,NULL,NULL,napi_default,NULL}, {"reply",NULL,reply,NULL,NULL,NULL,napi_default,NULL},
    {"close",NULL,close_js,NULL,NULL,NULL,napi_default,NULL}, {"inspectProcess",NULL,inspect_pid,NULL,NULL,NULL,napi_default,NULL},
    {"selfIdentity",NULL,self_identity,NULL,NULL,NULL,napi_default,NULL}};
  napi_define_properties(env,exports,sizeof(methods)/sizeof(methods[0]),methods); return exports;
}
