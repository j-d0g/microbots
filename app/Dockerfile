FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire `app` package so relative imports like `from app.routes …`
# resolve. WORKDIR is /app, and the package root needs to sit at /app/app so
# that `from app.main import app` works.
COPY . /app/app

ENV PYTHONPATH=/app
ENV PORT=8080
EXPOSE 8080

CMD ["python", "-m", "app.main"]
