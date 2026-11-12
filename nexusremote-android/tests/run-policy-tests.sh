#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
javac -d "$build" "$root/app/src/main/java/za/nexusremote/portal/PortalPolicy.java" "$root/tests/PortalPolicyTest.java"
java -cp "$build" za.nexusremote.portal.PortalPolicyTest
