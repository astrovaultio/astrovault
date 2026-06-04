FROM python:3.14-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ingest_worker.py .
CMD ["python", "ingest_worker.py"]
