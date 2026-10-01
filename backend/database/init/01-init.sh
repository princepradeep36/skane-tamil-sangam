#!/bin/sh
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  CREATE DATABASE skane_site;
  CREATE DATABASE click2eat;
EOSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname skane_site -f /docker-entrypoint-initdb.d/site.schema
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname click2eat -f /docker-entrypoint-initdb.d/food.schema
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname click2eat -f /docker-entrypoint-initdb.d/food-seed.schema
