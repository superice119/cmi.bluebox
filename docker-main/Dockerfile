# Docker image creation script for the Blue Box NOC
#
# To test out your changes:
#   1. Install Docker as per the instructions at
#      https://docs.docker.com/installation/, or just run the
#      develop_noc.sh script and follow the instructions
#   2. cd to the top-level of the source tree
#   3. docker build -t epflsti/blueboxnoc:dev docker-main
#      docker run -ti epflsti/blueboxnoc:dev /bin/bash
#
# To enact the changes, run build.sh again and restart the container
# with start_stop.sh restart.

FROM ubuntu
MAINTAINER Dominique Quatravaux <dominique.quatravaux@epfl.ch>

RUN apt-get update && apt-get -y upgrade && apt-get install -y tinc curl

# https://github.com/joyent/node/wiki/installing-node.js-via-package-manager#debian-and-ubuntu-based-linux-distributions
RUN curl -sL https://deb.nodesource.com/setup | sudo bash -
RUN apt-get install -y nodejs

# Apache
RUN apt-get install -y apache2
# https://www.digitalocean.com/community/tutorials/how-to-use-apache-http-server-as-reverse-proxy-using-mod_proxy-extension
RUN a2enmod proxy            && \
    a2enmod proxy_http       && \
    a2enmod proxy_ajp        && \
    a2enmod proxy_wstunnel   && \
    a2enmod rewrite          && \
    a2enmod deflate          && \
    a2enmod headers          && \
    a2enmod proxy_balancer   && \
    a2enmod proxy_connect    && \
    a2enmod proxy_html

# Dependencies of the plumbing code
RUN apt-get -y install liblog-message-perl libio-async-perl \
    libset-scalar-perl  libio-all-perl libjson-perl \
    libtry-tiny-perl libssh2-1-dev

# We also install the latest version of some packages "by hand" with
# CPANMinus.
RUN apt-get -y install cpanminus build-essential libarchive-zip-perl \
    libmodule-install-perl libssl-dev liblwp-protocol-https-perl
# We want the latest Future.pm; Module::Install::CheckLib is not
# Debian-packaged.
RUN cpanm Future \
     Module::Install::CheckLib
# Build and install latest version of Net::SSH2 right off GitHub!
# (Requires libarchive-zip-perl)
RUN cpanm https://github.com/rkitover/net-ssh2/archive/cdb99bad1dfa388c26d586b181d5465dad9a4723.zip

# http://www.rexify.org/get
RUN apt-get -y install libexpat1-dev libxml2-dev
RUN curl -L get.rexify.org | perl - --sudo -n Rex

# Remove all setuid privileges to lock down non-root users in the container
RUN find / -xdev -perm /u=s,g=s -print -exec chmod u-s,g-s '{}' \;
# Something really fishy is going on with
# /usr/bin/mail-{lock,touchlock,unlock}; these are all hard links to the same
# file, but chmod'ing any of these breaks the hard link ?! Probably a side
# effect of the filesystem fakes that Docker uses. Take no risk and just nuke
# the whole Debian package from orbit.
RUN dpkg --purge lockfile-progs
# Double check there are no setuid / setgid files left over.
RUN find / -xdev -perm /u=s,g=s | sed '/./q1'

# Expected mount points (see shlib/start_stop.sh):
# Code directory (top of the git checkout) -> /opt/blueboxnoc
# Data directory (w/ all persistent state) -> /srv
RUN rm -rf /etc/tinc && \
    ln -sf /srv/etc/tinc /etc/tinc && \
    rm -rf /usr/local/lib/site_perl && \
    ln -sf /opt/blueboxnoc/plumbing/perllib /usr/local/lib/site_perl && \
    mv /etc/apache2/apache2.conf /etc/apache2/apache2.conf.ORIG && \
    ln -sf /opt/blueboxnoc/plumbing/apache2.conf /etc/apache2 && \
    rm -rf /var/log/apache2 && \
    ln -sf /srv/log/apache2 /var/log/apache2

# The finishing touch:
RUN : > /this_is_docker

EXPOSE 80
# For tinc:
EXPOSE 655
EXPOSE 655/udp

# The command to run (unless coutermanded on the "docker run" command line).
CMD ["/opt/blueboxnoc/plumbing/init.pl"]
