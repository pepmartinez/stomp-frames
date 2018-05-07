var should = require('should');
var _ =      require('lodash');
var net =    require('net');
var Chance = require('chance');

var SF = require ('../');

var chance = new Chance();

const MandatoryHeaders = {
  CONNECT:     ['accept-version', 'host'],
  STOMP:       ['accept-version', 'host'],
  CONNECTED:   ['version'],
  SEND:        ['destination'],
  SUBSCRIBE:   ['destination', 'id'],
  UNSUBSCRIBE: ['id'],
  ACK:         ['id'],
  NACK:        ['id'],
  BEGIN:       ['transaction'],
  COMMIT:      ['transaction'],
  ABORT:       ['transaction'],
  DISCONNECT:  [],
  MESSAGE:     ['destination', 'message-id', 'subscription'],
  RECEIPT:     ['receipt-id'],
  ERROR:       [],
};

function frame() {
  var fr = new SF.Frame ();

  // get cmd
  var cmd = chance.pickone([ 
    'CONNECT', 
    'STOMP', 
    'CONNECTED',
    'SEND',
    'SUBSCRIBE',
    'UNSUBSCRIBE', 
    'ACK',
    'NACK', 
    'BEGIN',
    'COMMIT',
    'ABORT',
    'DISCONNECT',
    'MESSAGE',
    'RECEIPT',
    'ERROR']);
  
  fr.command(cmd);

  // add some extra headers
  for (var i = 0; i < chance.d20(); i++) {
    fr.header(chance.word(), chance.word());
  }
  
  // add mandatory headers
  _.forEach (MandatoryHeaders[cmd], function (hdr) {
    fr.header(hdr, chance.word());
  });

  fr.body(chance.paragraph ());

  return fr;
}




describe('STOMP frames', function () {

  before(function (done) {
    done();
  });


  after(function (done) {
    done();
  });

  it('does read with publishing mandatory headers', function (done) {
    var server = net.createServer (function(socket) {
      var ss = new SF.StompSession(socket);

      ss.on ('frame', function (f) {
        f.command().should.equal ('SUBSCRIBE');
        f.destination.should.equal ('someplace');
        f.id.should.equal ('meself');
        socket.end();
        server.close (done);
      });
    });

    server.listen(36667);


    var client = new net.Socket();
    client.connect(36667, '127.0.0.1', function() {
      var f = new SF.Frame ();
      f.command ('SUBSCRIBE');
      f.header ('destination', 'someplace');
      f.header ('id', 'meself');
      f.write (client);
    });
  });

  it('does travel fine over a socket (flow of 1111 random frames)', function (done) {
    var fr0 = [];

    for (var i = 0; i < 1111; i++) {
      var f = frame();
      f._semantic_validation();
      fr0.push (f);
    }

    var frr = [];

    var server = net.createServer (function(socket) {
      var ss = new SF.StompSession(socket);

      ss.on ('frame', function (f) {
        frr.push (f);

        if (frr.length == fr0.length) {
          frr.should.eql (fr0);
          socket.end();
          server.close (done);
        }
      });
    });

    server.listen(36667);


    var client = new net.Socket();
    client.connect(36667, '127.0.0.1', function() {
      _.forEach (fr0, function (f) {f.write (client)});
    });
  });


  it('does fail when building frame with unknown command', function (done) {
    var fr = frame ();
    try {
      fr.command ('nonvalid');
    }
    catch (e) {
      e.toString().should.equal ('Error: unrecognized STOMP command nonvalid');
      done();
    }
  });


  it('does fail when parsing frame with unknown command', function (done) {
    var server = net.createServer (function(socket) {
      var ss = new SF.StompSession(socket);
      ss.on ('error', function (e) {
        e.toString().should.equal ('Error: unrecognized STOMP command nonvalid');
        server.close (done);
      });
    });

    server.listen(36667);

    var client = new net.Socket();
    client.connect(36667, '127.0.0.1', function() {
      var fr = frame ();
      fr._cmd = 'nonvalid';
      fr.write (client);
    });
  });


  it('does send error frame in parsing error', function (done) {
    var server = net.createServer (function(socket) {
      var ss = new SF.StompSession(socket);
      ss.on ('error', function (e) {
        e.toString().should.equal ('Error: unrecognized STOMP command nonvalid');
      });
    });

    server.listen(36667);

    var client = new net.Socket();
    client.connect(36667, '127.0.0.1', function() {
      var ss = new SF.StompSession(client);
      ss.on ('frame', function (fe) {
        fe.should.match ({
          _cmd: 'ERROR',
          _headers: { 
            message: 'unrecognized STOMP command nonvalid',
            'content-length': '35' 
          },
          _body: 'unrecognized STOMP command nonvalid' 
        });

        server.close (done);
      });

      var fr = frame ();
      fr._cmd = 'nonvalid';
      fr.write (client);
    });
  });

});
