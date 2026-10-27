#!/bin/bash
set -euo pipefail

install -d -m 700 /opt/pot-https
install -m 700 .platform/scripts/*.sh /opt/pot-https/
/opt/pot-https/setup.sh
