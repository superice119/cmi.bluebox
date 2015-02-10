#!/usr/bin/perl -w

use strict;

=head1 NAME

EPFLSTI::Init - Support for writing the init.pl script

=head1 SYNOPSIS

  use IO::Async::Loop;
  use EPFLSTI::Init;

  my $loop = IO::Async::Loop;

  my $future = EPFLSTI::Init::DaemonProcess
     ->start($loop, "tincd", "--no-detach")
     ->when_ready(qr/Ready/)->then(sub {
    # Do something, return a Future
  });

=head1 DESCRIPTION

=cut

package EPFLSTI::Init::DaemonProcess;

use Future;
use IO::Async::Process;

sub start {
  my ($class, $loop, @command) = @_;
  my $self = bless {
    name => join(" ", @command),
    command => [@command],
    max_fails => 4,
    loop => $loop,
  }, $class;
  $self->_start_process_on_loop();
  return $self;
}

sub when_ready {
  my ($self, $running_re, $timeout) = @_;
  if (! defined $timeout) {
    $timeout = 30;
  }

  my $when = Future->new();

  $self->{_on_read} = sub {
    my ($bufref) = @_;
    if ($$bufref =~ $running_re) {
      $when->done($$bufref);
      $$bufref = "";
    };
  };

  $self->{on_too_many_restarts} = sub {
    $when->fail(shift);
  };

  $self->{ready_timeout} = $self->{loop}
    ->delay_future(after => $timeout)
    ->then(sub {
      # $when is still live, otherwise _make_quiet would have cancelled us.
      $when->fail("Timeout waiting for $self->{name} to start");
    });

  return $when->then(sub {$self->_make_quiet; $when},
                     sub {$self->_make_quiet; $when});
}

sub _make_quiet {
  my ($self) = @_;
  delete $self->{loop};  # Prevent cyclic garbage
  delete $self->{_on_read};
  delete $self->{on_too_many_restarts};
  if ($self->{ready_timeout}) {
    $self->{ready_timeout}->cancel();
  };
}

sub stop {
  my ($self) = @_;
  $self->_make_quiet();
  if ($self->{process}) {
    $self->{process}->kill("KILL");
  }
}

sub _start_process_on_loop {
  my ($self) = @_;
  do { warn "No loop"; return } unless (my $loop = $self->{loop});

  $self->{process} = new IO::Async::Process(
    command => $self->{command},
    stdin => { from => "" },
    stdout => { via => "pipe_read" },
    stderr => { via => "pipe_read" },
    on_finish => sub {
      if ($self->{max_restarts}--) {
        $self->_start_process_on_loop();
      } else {
        my $msg = $self->{name} . " failed too many times";
        warn $msg;
        if ($self->{on_too_many_restarts}) {
          $self->{on_too_many_restarts}->($msg);
        } else {
          # A flapping daemon causes init.pl to stop, even if ->when_ready()
          # has succeeded already.
          $loop->stop($msg);
        }
      }});

  foreach my $stream ($self->{process}->stdout(), $self->{process}->stderr()) {
    $stream->configure(on_read => sub {
      my ($stream, $buffref, $eof) = @_;
      if ($self->{_on_read}) {
        $self->{_on_read}->($buffref);
      } else {
        $$buffref = "";
      }
      return 0;
    });
  }

  $loop->add($self->{process});
}


require My::Tests::Below unless caller();

# To run the test suite:
#
# perl -Idevsupport/perllib plumbing/perllib/EPFLSTI/Init.pm

__END__

use Test::More qw(no_plan);
use Test::Group;

use Carp;

use IO::Async::Loop;
use IO::Async::Timer::Periodic;

{
  # For some reason, the Carp backtrace logic doesn't work if this is kept in
  # the main package?
  package TestUtils;

  sub await_ok ($&;$) {
    my ($loop, $sub, $msg) = @_;

    my $timeout = 10;
    my $interval = 0.1;

    my $timedout = Carp::shortmess("await_ok timed out");

    my $done = undef;
    my $timer = IO::Async::Timer::Periodic->new(
      interval => $interval,
      on_tick => sub {
        $timeout -= $interval;
        if ($timeout <= 0) {
          Test::More::fail($timedout);
          $loop->stop();
        } elsif ($sub->()) {
          Test::More::ok($msg);
          $loop->stop();
        }
      });
    $timer->start();
    $loop->add($timer);
    $loop->run();
  }
}

BEGIN { *await_ok = \&TestUtils::await_ok; }

test "await_ok: positive" => sub {
  my $loop = new IO::Async::Loop;
  my $are_we_there_yet = 0;
  my $unused = $loop->delay_future(after => 1)->then(sub {
    $are_we_there_yet = 1;
  });
  await_ok $loop, sub {$are_we_there_yet}, "awaits ok";
};

test "DaemonProcess: fire and forget" => sub {
  my $loop = new IO::Async::Loop;
  my $touched = My::Tests::Below->tempdir() . "/touched.1";
  my $daemon = EPFLSTI::Init::DaemonProcess->start(
    $loop, "sh", "-c", "sleep 1 && touch $touched && sleep 30");
  ok(! -f $touched);
  await_ok $loop, sub {-f $touched};
  $daemon->stop();
};

test "DaemonProcess: expect message" => sub {
  my $loop = new IO::Async::Loop;
  my $done = 0;
  my $daemon = EPFLSTI::Init::DaemonProcess
    ->start($loop, "sh", "-c", "sleep 1 && echo Ready && sleep 30");
  my $future = $daemon->when_ready(qr/Ready/)->then(sub {
        $done = 1;
  });
  await_ok $loop, sub { $done };
  $daemon->stop();
};

test "DaemonProcess: dies too often" => sub {
  my $loop = new IO::Async::Loop;
  my $daemon = EPFLSTI::Init::DaemonProcess
    ->start($loop, "/bin/true");
  my $result = $loop->run();
  like $result, qr|/bin/true|;
  like $result, qr/failed too many times/;
};

# In case of process leak, will block here.
while (wait() != -1) {};
1;
