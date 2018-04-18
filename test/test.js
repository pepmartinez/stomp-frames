var should = require('should');
//var async = require('async');
var _ = require('lodash');
var net =     require('net');
var Chance = require('chance');

var SF = require ('../')

var chance = new Chance();

function frame() {
  var fr = new SF.Frame ();

  fr.command(chance.pickone(['alpha', 'bravo', 'charlie', 'delta', 'echo']));

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

  it('does travel fine over a socket', function (done) {
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

});
