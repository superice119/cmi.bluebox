#!/usr/bin/perl -w

use strict;

=head1 NAME

firsttime.pl – One-time initialization of the Blue Box NOC

=head1 DESCRIPTION

Started by init.pl upon booting the container.

Creates a skeleton tinc config, RSA keypair.

=cut

use EPFLSTI::Docker::Log -main => "firsttime.pl";

foreach my $emptydir (qw(/srv/etc /srv/etc/tinc /srv/log /srv/log/apache2)) {
  if (! -d $emptydir) {
    msg "Creating $emptydir";
    mkdir($emptydir);
  }
}

unless (-f "/etc/tinc/rsa_key.pub" && -f "/etc/tinc/rsa_key.priv") {
  msg "Generating tinc key pair";
  system("tincd -K");
}
