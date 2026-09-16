FROM python:3.10-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000 \
    WHISPER_MODEL=base

# Install ffmpeg (required by Whisper) and git
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install PyTorch CPU (saves ~2GB vs default CUDA torch) and other dependencies
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download the default base Whisper model so Railway healthcheck won't timeout
RUN python -c "import whisper; whisper.load_model('base')"

# Copy application source
COPY . .

# Expose port (Railway overrides this via $PORT at runtime)
EXPOSE 8000

# Start Uvicorn bound to 0.0.0.0 and dynamic $PORT
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
