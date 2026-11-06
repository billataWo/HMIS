#!/bin/sh
# Prepares MinIO as the WORM off-site store for HMIS backups. Safe to re-run.
#   docker compose run --rm admin bucket            create/repair the locked bucket and its rules
#   docker compose run --rm admin site <prefix>     create the storage key for one clinic server
# Any other S3 provider needs the same settings, made in its own console (docs/backup/README.md).
set -eu

BUCKET=${BUCKET:-hmis-backups}
LOCK_DAYS=${LOCK_DAYS:-30}               # nobody, not even the storage admin, can delete a version younger than this
KEEP_VERSIONS_DAYS=${KEEP_VERSIONS_DAYS:-90}  # deleted/replaced files stay recoverable this long
ARCHIVE_YEARS=${ARCHIVE_YEARS:-10}       # monthly long-term archives

mc alias set off "${MINIO_URL:-http://minio:9000}" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

bucket() {
  if ! mc ls "off/$BUCKET" >/dev/null 2>&1; then
    mc mb --with-lock "off/$BUCKET"
  fi
  # Object lock implies versioning: overwriting or deleting adds a version, the old one stays.
  mc retention set --default COMPLIANCE "${LOCK_DAYS}d" "off/$BUCKET"
  mc ilm rule rm --all --force "off/$BUCKET" >/dev/null 2>&1 || true
  mc ilm rule add --noncurrent-expire-days "$KEEP_VERSIONS_DAYS" "off/$BUCKET"
  mc ilm rule add --prefix "archive/" --expire-days "$((ARCHIVE_YEARS * 365))" "off/$BUCKET"
  echo "Bucket $BUCKET: versions locked (COMPLIANCE) for $LOCK_DAYS days, kept $KEEP_VERSIONS_DAYS days after replacement; archives kept $ARCHIVE_YEARS years."
  mc retention info --default "off/$BUCKET"
}

site() {
  prefix=$1
  case $prefix in *[!a-z0-9-]* | "") echo "Use lowercase letters, digits and dashes: $prefix" >&2; exit 2 ;; esac
  user="hmis-$prefix"
  secret=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)
  policy=/tmp/policy-$prefix.json
  # The site can add and read its own backups and mark files deleted (which only hides them).
  # It cannot delete versions, shorten locks, change the bucket's rules, or see other sites.
  cat >"$policy" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketVersions"],
      "Resource": ["arn:aws:s3:::$BUCKET"],
      "Condition": {"StringLike": {"s3:prefix": ["pgbackrest/$prefix", "pgbackrest/$prefix/*", "archive/$prefix", "archive/$prefix/*"]}}
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::$BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": ["arn:aws:s3:::$BUCKET/pgbackrest/$prefix/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": ["arn:aws:s3:::$BUCKET/archive/$prefix/*"]
    }
  ]
}
EOF
  mc admin policy create off "hmis-site-$prefix" "$policy" >/dev/null
  if mc admin user info off "$user" >/dev/null 2>&1; then
    echo "Key $user already exists; giving it a new secret."
  fi
  mc admin user add off "$user" "$secret" >/dev/null
  mc admin policy attach off "hmis-site-$prefix" --user "$user" >/dev/null 2>&1 || true
  rm -f "$policy"
  echo "Put these in the clinic server's deploy/.env:"
  echo "OFFSITE_S3_BUCKET=$BUCKET"
  echo "OFFSITE_S3_PREFIX=$prefix"
  echo "OFFSITE_S3_ACCESS_KEY=$user"
  echo "OFFSITE_S3_SECRET_KEY=$secret"
}

case ${1:-} in
  bucket) bucket ;;
  site) site "${2:-}" ;;
  *) echo "usage: minio.sh bucket | site <prefix>" >&2; exit 2 ;;
esac
