"""Same-origin owner endpoints; public entries never gain administrative authority."""
import hmac,json
from urllib.parse import urlsplit
OWNER_ORIGINS={'https://317mx.duckdns.org'}
LOCAL_PREVIEW=False


def owner_get(handler,director):
    if urlsplit(handler.path).path!='/api/events/owner/status':return handler.send_json(404,dict(error='Not found'))
    with director.lock:
        if handler.headers.get('Origin') and handler.headers['Origin'] not in OWNER_ORIGINS:
            return handler.send_json(403,dict(error='Use the official 317MX dashboard'))
        session=director.auth.session(handler.headers.get('Cookie'))
        if not session:return handler.send_json(401,dict(error='Pair with your in-game owner code'))
        handler.send_json(200,dict(director.owner_view(),csrf=session['csrf'],sessionExpires=session['expires']))


def owner_post(handler,director):
    path=urlsplit(handler.path).path
    if path not in ('/api/events/owner/login','/api/events/owner/action','/api/events/owner/logout'):
        return handler.send_json(404,dict(error='Not found'))
    if handler.headers.get('Origin') not in OWNER_ORIGINS:
        return handler.send_json(403,dict(error='Use the official 317MX dashboard'))
    if handler.headers.get_content_type()!='application/json':return handler.send_json(415,dict(error='Use JSON'))
    try:
        size=int(handler.headers.get('Content-Length','0'))
        if not 0<size<=2048:raise ValueError('Invalid request size')
        value=json.loads(handler.rfile.read(size))
        if not isinstance(value,dict):raise ValueError('Invalid request')
        with director.lock:
            if path.endswith('/login'):
                token,session=director.auth.login(value.get('code'),handler.headers.get('X-Real-IP') or handler.client_address[0])
                cookie='317mx_owner='+token+'; Path=/api/events/owner; HttpOnly; SameSite=Strict; Max-Age=604800'
                if not LOCAL_PREVIEW:cookie+='; Secure'
                return handler.send_json(200,dict(ok=True,**session),{'Set-Cookie':cookie})
            session=director.auth.session(handler.headers.get('Cookie'))
            if not session:return handler.send_json(401,dict(error='Owner session expired'))
            if not hmac.compare_digest(handler.headers.get('X-CSRF-Token',''),session['csrf']):
                return handler.send_json(403,dict(error='Refresh the dashboard before sending an action'))
            if path.endswith('/logout'):
                director.auth.revoke(session['digest'])
                return handler.send_json(200,dict(ok=True),{'Set-Cookie':'317mx_owner=; Path=/api/events/owner; HttpOnly; Secure; SameSite=Strict; Max-Age=0'})
            result=director.owner_action(value)
        handler.send_json(200,result)
    except (ValueError,TypeError,OverflowError) as error:
        handler.send_json(400,dict(error=str(error)))
