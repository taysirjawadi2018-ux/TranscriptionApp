FROM python:3.10-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000 \
    WHISPER_MODEL=base

# Install ffmpeg (required by Whisper to decode audio) and git
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements from transcription-backend
COPY transcription-backend/requirements.txt .

# Upgrade pip, setuptools, and wheel, then install torch (CPU) and dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir torch --extra-index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download the default base Whisper model so Railway healthcheck won't timeout
RUN python -c "import whisper; whisper.load_model('base')"

# Copy backend application source into container
COPY transcription-backend/ .

# Expose port (Railway overrides this via $PORT at runtime)
EXPOSE 8000

# Start Uvicorn bound to 0.0.0.0 and dynamic $PORT
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
