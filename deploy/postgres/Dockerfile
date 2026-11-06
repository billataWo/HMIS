# PostgreSQL with the HMIS backup tooling: pgBackRest (physical backups + point-in-time
# recovery), rclone (off-site copy to S3-compatible WORM storage) and age (encryption of the
# long-term archive). The same image runs the database ("db") and the backup worker ("backup").
FROM postgres:17.11

RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest rclone age jq curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /backup /var/log/pgbackrest \
 && chown -R postgres:postgres /backup /var/log/pgbackrest

COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY --chmod=755 scripts/ /opt/hmis-backup/
ENV PATH="/opt/hmis-backup:${PATH}"
