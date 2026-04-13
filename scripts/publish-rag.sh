#!/usr/bin/env bash

# copy rag output form .opensona/output to public/rag to be served by mikoshidb.net
set -euo pipefail
mkdir -p public/rag
cp -R .opensona/output/. public/rag/
