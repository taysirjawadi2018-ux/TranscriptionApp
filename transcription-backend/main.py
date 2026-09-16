from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv
import os
import whisper
import shutil
load_dotenv()

# Initialize Whisper model (configurable via WHISPER_MODEL env var, default: base)
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
print(f"Loading Whisper model '{WHISPER_MODEL_NAME}'...")
model = whisper.load_model(WHISPER_MODEL_NAME)
print(f"Whisper model '{WHISPER_MODEL_NAME}' loaded successfully.")

# Initialize Qwen client using the OpenAI-compatible API
# Supports Alibaba Cloud DashScope, OpenRouter, Groq, or any OpenAI-compatible provider
QWEN_API_KEY = os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or os.getenv("OPENAI_API_KEY")
QWEN_BASE_URL = os.getenv("QWEN_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
QWEN_MODEL = os.getenv("QWEN_MODEL", "qwen-plus")

if not QWEN_API_KEY:
    print("WARNING: Qwen API key (QWEN_API_KEY / DASHSCOPE_API_KEY) not found in environment variables!")

client = OpenAI(api_key=QWEN_API_KEY, base_url=QWEN_BASE_URL) if QWEN_API_KEY else None

app = FastAPI(title="Transcription & AI Study Assistant API (Qwen-Powered)")

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add logging for debugging requests
@app.middleware("http")
async def log_requests(request, call_next):
    import time
    start_time = time.time()
    
    # Log the request
    print(f"Request path: {request.url.path}")
    print(f"Request method: {request.method}")
    print(f"Request headers: {request.headers}")
    
    # Process the request
    response = await call_next(request)
    
    # Log the response
    process_time = time.time() - start_time
    print(f"Request completed in {process_time:.4f}s")
    print(f"Response status: {response.status_code}")
    
    return response

# Root and health check endpoints
@app.get("/")
async def root():
    return {
        "status": "ok",
        "message": "Transcription & AI Study Assistant API is running",
        "transcription_model": f"whisper-{WHISPER_MODEL_NAME}",
        "llm_model": QWEN_MODEL
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Endpoint: /transcribe - transcribes audio file using Whisper
@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        os.makedirs("temp", exist_ok=True)
        file_path = f"temp/{file.filename}"

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        try:
            result = model.transcribe(file_path)
            transcription = str(result.get("text", ""))
        except Exception as model_error:
            transcription = f"Transcription failed: {str(model_error)}"
        finally:
            os.remove(file_path)

        return JSONResponse(content={"text": transcription})

    except Exception as e:
        return JSONResponse(content={"error": str(e)})

# Request model for summarization
class SummaryRequest(BaseModel):
    text: str
    prompt: str = ""

# Endpoint: /summarize - summarizes text using GPT-4
@app.post("/summarize")
async def summarize_text(data: SummaryRequest):
    try:
        # Log the request data size
        print(f"Summarize request received, text length: {len(data.text)} chars")
        
        if not client:
            return JSONResponse(
                status_code=500,
                content={"error": "Qwen API key is not configured on the server. Please set QWEN_API_KEY (or DASHSCOPE_API_KEY / OPENAI_API_KEY) in Railway environment variables."}
            )

        # Validate the request data
        if not data.text:
            print("Error: Empty text field in summarize request")
            return JSONResponse(
                status_code=400,
                content={"error": "Text field is required and cannot be empty"}
            )
            
        # Check if text is too large
        if len(data.text) > 100000:
            print(f"Error: Text too large ({len(data.text)} chars)")
            return JSONResponse(
                status_code=413,
                content={"error": "Text is too large to process. Please reduce the size."}
            )

        messages = []
        if data.prompt:
            # Use custom prompt if provided
            messages.append({"role": "system", "content": data.prompt})
        else:
            # Default to bullet point summary if no prompt is provided
            default_prompt = """
            Create a concise bullet point summary of the following text. 
            Focus on the key points and main ideas.
            Format your response as a series of bullet points (•).
            Each bullet point should be brief but informative.
            """
            messages.append({"role": "system", "content": default_prompt})
            
        messages.append({"role": "user", "content": data.text})

        response = client.chat.completions.create(
            model=QWEN_MODEL,
            messages=messages,
            max_tokens=800
        )

        summary = response.choices[0].message.content.strip()
        print("Summary generated successfully")
        return JSONResponse(content={"summary": summary})

    except Exception as e:
        import traceback
        print(f"Error in summarize endpoint: {str(e)}")
        print(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

# Request model for quiz generation
class QuizRequest(BaseModel):
    text: str

# Endpoint: /generate-quiz - generates a quiz using GPT-4
@app.post("/generate-quiz")
async def generate_quiz(data: QuizRequest):
    try:
        # Log the request data size
        print(f"Quiz generation request received, text length: {len(data.text)} chars")
        
        if not client:
            return JSONResponse(
                status_code=500,
                content={"error": "Qwen API key is not configured on the server. Please set QWEN_API_KEY (or DASHSCOPE_API_KEY / OPENAI_API_KEY) in Railway environment variables."}
            )

        # Validate the request data
        if not data.text:
            print("Error: Empty text field in quiz generation request")
            return JSONResponse(
                status_code=400,
                content={"error": "Text field is required and cannot be empty"}
            )
            
        # Check if text is too large
        if len(data.text) > 100000:
            print(f"Error: Text too large ({len(data.text)} chars)")
            return JSONResponse(
                status_code=413,
                content={"error": "Text is too large to process. Please reduce the size."}
            )

        prompt = """
        Based on the following text, create a knowledge check quiz with 5 multiple-choice questions.
        For each question:
        1. Create a clear, concise question about an important concept from the text
        2. Provide 4 possible answers (A, B, C, D), with only one being correct
        3. Indicate the correct answer at the end of each question
        
        Format the quiz like this:
        
        Question 1: [Question text]
        A. [Option A]
        B. [Option B]
        C. [Option C]
        D. [Option D]
        Answer: [Correct letter]
        
        [Repeat for all 5 questions]
        """
        
        response = client.chat.completions.create(
            model=QWEN_MODEL,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": data.text}
            ],
            max_tokens=1500
        )

        quiz = response.choices[0].message.content.strip()
        print("Quiz generated successfully")
        return JSONResponse(content={"quiz": quiz})

    except Exception as e:
        import traceback
        print(f"Error in generate-quiz endpoint: {str(e)}")
        print(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
