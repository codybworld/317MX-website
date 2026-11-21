import importlib.util,json,tempfile,threading
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('event_api',root/'server/event_api.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
with tempfile.TemporaryDirectory() as folder:
    api.DIRECTOR=api.Director(folder,json.loads((root/'server/event.json').read_text()))
    server=api.Server(('127.0.0.1',0),api.Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    origin='http://127.0.0.1:'+str(server.server_port)
    signup=origin+'/api/events/'+api.DIRECTOR.config['id']+'/signup'
    def post(value,website='https://317mx.duckdns.org'):
        return urlopen(Request(signup,data=json.dumps(value).encode(),headers={'Content-Type':'application/json','Origin':website}),timeout=5)
    with post(dict(name='Browser test',number='317',uid=99999999)) as response:
        assert response.status==200
        assert response.headers['Access-Control-Allow-Origin']=='https://317mx.duckdns.org'
    with urlopen(origin+'/api/events',timeout=5) as response:
        data=json.load(response);assert data['entries'][0]['uid']==99999999
    with post(dict(name='Browser test',number='317',uid=99999999),'https://codybworld.github.io') as response:
        assert response.status==200
        assert response.headers['Access-Control-Allow-Origin']=='https://codybworld.github.io'
    for value,website,code in [(dict(name='X',number='1',uid=True),'https://317mx.duckdns.org',400),({},'https://example.com',403)]:
        try:post(value,website);raise AssertionError('Request unexpectedly accepted')
        except HTTPError as error:assert error.code==code
    try:urlopen(Request(origin+'/api/events/admin',data=b'{}',headers={'Content-Type':'application/json'}));raise AssertionError('Admin endpoint exposed')
    except HTTPError as error:assert error.code==404
    with urlopen(Request(signup,method='OPTIONS',headers={'Origin':'https://codybworld.github.io'})) as response:
        assert response.status==204
    server.shutdown();server.server_close();api.DIRECTOR.db.close()
print('PASS: real HTTP signup, shared entry reads, duplicate handling, both website origins, rejected malformed/foreign requests and no public admin endpoint.')
