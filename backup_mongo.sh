#!/bin/bash

set -e
BACKUP_FILE_NAME=mongo_backup_$(date +%d-%m-%y_%H-%M).gz
DB=<DB_NAME>
DB_USER_NAME=<USERNAME>
DB_PASSWORD=<DB_PASSWORD>
ARCHIVE_DIR=/home/mongo-backups
SCRIPT_PATH=/home/upload-file-to-s3-cli

date
echo "Backing up MongoDB database to $SERVER_IP has started...."

mkdir -p $ARCHIVE_DIR
echo "Dumping MongoDB $DB database to compressed archive"

mongodump --db=$DB --archive=$ARCHIVE_DIR/$BACKUP_FILE_NAME --gzip -u $DB_USER_NAME -p $DB_PASSWORD  --authenticationDatabase admin

echo "Uploading file to s3 bucket and cleanup up compressed archive"
cd /home/upload-file-to-s3-cli
node index.js $ARCHIVE_DIR/$BACKUP_FILE_NAME -d

echo 'Backup complete!'


