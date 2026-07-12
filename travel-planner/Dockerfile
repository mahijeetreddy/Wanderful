FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig*.json vite.config.ts tailwind.config.js postcss.config.js ./
COPY src ./src
RUN npm run build

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN useradd --create-home wanderful
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=frontend /app/dist ./dist
RUN chown -R wanderful:wanderful /app
USER wanderful
EXPOSE 5052
CMD ["gunicorn", "--bind", "0.0.0.0:5052", "--workers", "2", "--threads", "4", "--timeout", "120", "web_app:app"]
