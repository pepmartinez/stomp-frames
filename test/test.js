var should = require('should');
//var async = require('async');
var _ = require('lodash');
var net =     require('net');
var Chance = require('chance');

var SF = require ('../')

var chance = new Chance();

function frame() {
  var fr = new SF.Frame ();

  fr.command(chance.pickone([ 
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
    'ERROR']));

  for (var i = 0; i < chance.d20(); i++) {
    fr.header(chance.word(), chance.word());
  }

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


  it('does travel fine over a socket (flow of 1111 random frames)', function (done) {
    var fr0 = [];

    for (var i = 0; i < 1111; i++) {
      fr0.push (frame ());
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
