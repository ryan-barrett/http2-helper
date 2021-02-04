# Http2 Helper
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/http2-helper.svg)](https://badge.fury.io/js/http2-helper)

A decorator based npm package intended to simplify organizing http2 listeners, as well as providing 
the ability to easily manage multiple http2 connections. 

### Usage

First we need to instantiate a named server. We can do this over http as shown below, or alternatively over [https](https://nodejs.org/api/http2.html) using a cert
and key

```
const server = Http2ServerFactory.Create('test');
server.listen(8000);
```

```
const server = Http2ServerFactory.Create('test', key, cert);
server.listen(8000);
```

### @Http2Listener

The first and most central decorator is our Http2Listener. A method with this decorator will be triggered when a stream
is instantiated on the server side. The `stream` and `headers` arguments will be provided, and our method can use
them to interact with the client. Our listeners will be run in the order they are declared, so we can safely handle the
initial handshake as part of our first method.

```
class Example {
  @Http2Listener('test')
  private thisWillBeAStreamHandler(stream, headers) {
    stream.respond({ ':status': 200, 'content-type': 'text/plain' });
    stream.write('hello ');

    for (let i = 5; i > 0; i--) {
      stream.write('hello ');
    }
  };
}
```

### @Http2Poll

Frequently we might want to have a client connect and receive periodic updates from the server. In that case we can use
Http2Poll. The first argument is a name of the specific server we want to be a listener for, and the second argument is
the interval on which we want to run our handler. In the example below we will write `polling...` to the stream every
5 seconds.

```
@Http2Poll('test', 5000)
private thisWillBeAPollingMethod(stream, headers) {
  stream.write('polling...');
}
```

### @Http2SessionListener

Similar to Http2Listener, Http2SessionListener will trigger when a session event is fired by a newly instantiated stream.
This can be used when session data is required.

```
@Http2SessionListener('test')
private thisWillBeASessionHandler(session) {
  console.log('a session!', session);
}
```

### @Http2ServerBroadcast

Http2ServerBroadcast works in a slightly different way. Rather than being an event handler, a method decorated with this
is intended to be called directly. When invoked our method will write the return value to all currently 
active http2 connections on a server. This can be useful when we want to do something like send a maintenance 
(or other system wide) alert to all currently active users / connections.

```
@Http2ServerBroadcast('test')
public broadcastTheOutput() {
  return 'a whole new wooooorld';
}
```

### Misc

If needed we are still able to treat our server instance as a normal http2 server:

```
const server = Http2ServerFactory.Create('test');
server.listen(8000);

server.on('stream', (stream) => {
  stream.write('we can still do it this way');
});
```

This allows us to offer flexibility and extensibility to users.
