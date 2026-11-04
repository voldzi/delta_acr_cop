"""Pure generation of app-owned persistent deadline units. No host actions.
Installation/readback and the concrete deadline handler are separate, required
artifacts; rendering these files alone NEVER means a timer is armed.
"""
import datetime,re
UUID=re.compile('[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
def files(window_id,deadline):
 if not isinstance(window_id,str) or not UUID.fullmatch(window_id) or type(deadline) is not int or deadline<180:raise ValueError('WINDOW_TIMER_SCOPE')
 name='cop-vehicle-window-close-'+window_id;when=datetime.datetime.fromtimestamp(deadline-180,datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
 service=('[Unit]\nDescription=Close the one approved COP vehicle admission window\nAfter=docker.service\n[Service]\nType=oneshot\nUser=root\nGroup=root\nEnvironment=LANG=C\nEnvironment=TZ=UTC\nExecStart=/usr/bin/python3 -I /usr/local/lib/cop-vehicle-window/deadline.py\nTimeoutStartSec=240\nRestart=no\n').encode()
 timer=('[Unit]\nDescription=Deadline for the one approved COP vehicle admission window\n[Timer]\nOnCalendar='+when+'\nAccuracySec=1s\nRandomizedDelaySec=0\nPersistent=true\nUnit='+name+'.service\n[Install]\nWantedBy=timers.target\n').encode()
 return {name+'.service':service,name+'.timer':timer}
def armed_readback(window_id,deadline,actual_files,properties):
 expected=files(window_id,deadline);name='cop-vehicle-window-close-'+window_id
 return actual_files==expected and properties.get('LoadState')=='loaded' and properties.get('ActiveState')=='active' and properties.get('UnitFileState')=='enabled' and properties.get('Triggers')==name+'.service' and properties.get('FragmentPath')=='/etc/systemd/system/'+name+'.timer' and properties.get('Persistent')=='yes' and properties.get('DropInPaths','')=='' and properties.get('NextElapseUSecRealtime') not in (None,'','n/a')
