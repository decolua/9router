#!/usr/bin/env bash
#!/bin/bash

rsync -avP --delete 9router:~/.9router/ /var/lib/9router/
