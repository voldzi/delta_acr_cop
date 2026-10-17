"""Owned loopback TLS transport only. Actual requests reach actual Synapse.
No synthetic provider responses, redirects, request logs or public listener.
"""
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ssl


class Proxy(BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def forward(self):
        if not self.path.startswith(('/_matrix/','/_synapse/admin/','/_synapse/client/cop/')) or len(self.path)>8192:
            self.send_error(404); return
        length = self.headers.get('content-length','0')
        if not length.isdecimal() or int(length)>1048576 or self.headers.get('transfer-encoding'):
            self.send_error(400); return
        body = self.rfile.read(int(length)) if int(length) else None
        headers = {k:v for k,v in self.headers.items() if k.lower() not in {'host','connection','transfer-encoding'}}
        c = http.client.HTTPConnection('127.0.0.1',8008,timeout=15)
        try:
            c.request(self.command,self.path,body=body,headers=headers)
            r = c.getresponse(); data = r.read(1048577)
            if len(data)>1048576: self.send_error(502); return
            self.send_response(r.status)
            for k,v in r.getheaders():
                if k.lower() not in {'connection','transfer-encoding','content-length'}: self.send_header(k,v)
            self.send_header('content-length',str(len(data)));self.end_headers()
            if self.command!='HEAD':self.wfile.write(data)
        except (OSError,http.client.HTTPException):
            self.send_error(503)
        finally:c.close()

    do_GET=do_POST=do_PUT=do_DELETE=do_HEAD=forward


context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.minimum_version=ssl.TLSVersion.TLSv1_2
context.load_cert_chain('/fixture-cert.pem','/fixture-key.pem')
server=ThreadingHTTPServer(('127.0.0.1',443),Proxy)
server.socket=context.wrap_socket(server.socket,server_side=True)
server.serve_forever()
