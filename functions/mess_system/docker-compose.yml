services:
  db:
    image: postgres:18
    container_name: mess_postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: mess
    ports:
      - "5432:5432"
    volumes:
      - ./db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
      - ./db/seed.sql:/docker-entrypoint-initdb.d/02-seed.sql:ro
    restart: unless-stopped

  api:
    build: ./backend
    container_name: mess_backend
    depends_on:
      - db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: mess
      POSTGRES_HOST: db
      POSTGRES_PORT: 5432
      # If your code supports DATABASE_URL, you can use that instead:
      # DATABASE_URL: postgresql+psycopg2://postgres:pass@db:5432/mess
    ports:
      - "8000:8000"
    restart: unless-stopped
