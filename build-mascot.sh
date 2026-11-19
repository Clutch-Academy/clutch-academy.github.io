#!/bin/sh
# Regenerates the clean-path copies (/mascot/ and /mascot-host/) from the two
# source pages. Run this after editing mascot.html or mascot-host.html.
set -e
cd "$(dirname "$0")"
mkdir -p mascot mascot-host
cp mascot.html mascot/index.html
# The host copy sits one folder deeper, so the vendored QR script moves up a level.
sed 's#src="vendor/qrcode.min.js"#src="../vendor/qrcode.min.js"#' mascot-host.html > mascot-host/index.html
echo "rebuilt mascot/index.html and mascot-host/index.html"
