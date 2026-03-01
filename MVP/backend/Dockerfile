FROM python:3.11-slimWORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . ./app
EXPOSE 8000