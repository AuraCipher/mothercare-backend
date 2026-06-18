#!/bin/bash
# Create upload directories after fresh install
mkdir -p uploads/{profiles,documents,temp}
touch uploads/{profiles,documents,temp}/.gitkeep
echo "✅ Upload directories created"
