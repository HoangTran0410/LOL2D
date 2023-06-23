## PeerJS

#### Install and Run peer server

Documents: [peerjs-client](https://peerjs.com/), [peerjs-server](https://github.com/peers/peerjs-server)

```node
npm i -g peerjs
peerjs --port 9000 --key peerjs --allow_discovery true
```

#### Public localhost server to internet

Documents: [serveo.net](http://serveo.net/) or using [localhost.run](https://localhost.run/)

```node
// example for using serveo.net
ssh -R 80:localhost:9000 nokey@localhost.run 

// optional
// add "-o ServerAliveInterval=6000" to keep connection alive
```

#### Client

index.html

```html
<script src="https://unpkg.com/peerjs@1.4.7/dist/peerjs.min.js"></script>
```

main.js

```js
var peer = new Peer('', {
  secure: true, // using https if server is public on serveo.net
  host: 'localhost', // or serveo.net
  port: 9000, // or 443 if using serveo.net
  path: '/',
});
```

#### Get list of peers-client connected to server

<http://localhost:9000/get/peers>
