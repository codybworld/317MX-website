from pathlib import Path
import sys,tempfile,json,threading
from urllib.request import Request,urlopen
from urllib.error import HTTPError
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT/'server'))
import event_api as api

with tempfile.TemporaryDirectory() as folder:
    api.DIRECTOR=api.Director(folder,json.loads((ROOT/'server/event.json').read_text()))
    old=json.loads((ROOT/'reference/archived-event.json').read_text())['event'];old.update(archived=True,entriesOpen=False)
    api.DIRECTOR.db.execute('INSERT INTO archives VALUES(?,?,?,?)',(old['event']['id'],old['event']['startsAt'],json.dumps(old),api.DIRECTOR.clock()));api.DIRECTOR.db.commit()
    server=api.Server(('127.0.0.1',0),api.Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
    base='http://127.0.0.1:'+str(server.server_port)
    def call(path,body=None,cookie=None,csrf=None,origin='https://317mx.duckdns.org'):
        headers={'Origin':origin}
        if cookie:headers['Cookie']=cookie
        if csrf:headers['X-CSRF-Token']=csrf
        if body is not None:headers['Content-Type']='application/json'
        request=Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        try:
            with urlopen(request,timeout=5) as response:return response.status,dict(response.headers),json.load(response)
        except HTTPError as error:return error.code,dict(error.headers),json.load(error)
    assert call('/api/events/owner/status')[0]==401
    assert call('/api/events/'+old['event']['id']+'/signup',dict(name='Late',number='1',uid=1))[0]==400
    assert call('/api/events/'+api.DIRECTOR.config['id']+'/signup',dict(name='New Rider',number='1',uid=1))[0]==200
    assert call('/api/events/owner/action',dict(type='command',command='end',requestId='forged-request'))[0]==401
    code=api.DIRECTOR.auth.issue()
    assert call('/api/events/owner/login',dict(code=code),origin='https://evil.example')[0]==403
    status,headers,login=call('/api/events/owner/login',dict(code=code));assert status==200
    cookie=headers['Set-Cookie'].split(';')[0]
    assert all(part in headers['Set-Cookie'] for part in ('Secure','HttpOnly','SameSite=Strict'))
    assert call('/api/events/owner/status',cookie=cookie)[0]==200
    body=dict(type='command',command='status',requestId='valid-status-12345')
    assert call('/api/events/owner/action',body,cookie=cookie)[0]==403
    assert call('/api/events/owner/action',body,cookie=cookie,csrf=login['csrf'])[0]==200
    assert call('/api/events/owner/action',body,cookie=cookie,csrf=login['csrf'])[0]==200
    assert call('/api/events/owner/logout',{},cookie=cookie,csrf=login['csrf'])[0]==200
    assert call('/api/events/owner/status',cookie=cookie)[0]==401
    assert call('/api/events/owner/login',dict(code=code))[0]==400
    server.shutdown();server.server_close();api.DIRECTOR.db.close()
print('PASS: shared entries, archived signup rejection, owner-only session, same-origin and CSRF protection, replay-safe actions and logout.')
