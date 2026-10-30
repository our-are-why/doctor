#!/bin/sh

# Usage: buildContainer.sh [image-name]
#   image-name  defaults to the project directory's name, lowercased

set -eu

# Run from the project root, wherever this script is called from
cd "$(dirname "$0")/../.."

image_name=${1:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]')}

# --no-cache so the project's own install steps run again and pick up their
# latest versions
container build --no-cache -t "$image_name" -f ./.environment/Containerfile .
