# ForgeNote

**English** | [简体中文](README.md)

ForgeNote is a local AI desktop app for university-level learning. It turns lecture notes, papers, web pages, and personal notes into a traceable knowledge base, then uses that context to create explanations, quizzes, flashcards, mind maps, coding labs, further reading, and podcasts.

![A course knowledge base in ForgeNote](docs/assets/demo-knowledge-base.jpg)

## Core features

- **Course knowledge bases** — Import PDFs, Word documents, web pages, audio, and text, with parsing, chunking, retrieval, and source management built in.
- **Source-grounded Q&A** — Ask questions about selected materials while preserving context and citations.
- **Learning asset generation** — Create explanations, quizzes, flashcards, mind maps, reading materials, coding labs, and images from the same course context.
- **Personalized learning loop** — Adapt future content and learning paths using learner profiles, quiz results, mistakes, and learning events.
- **Observable background jobs** — Track parsing, generation, and podcast jobs in one place, with clear quota, authentication, and model errors.
- **Local desktop experience** — Run the backend, frontend, database, and FFmpeg in a self-contained Windows app powered by WebView2.

## Course demo

The repository includes a reproducible university-course test set. The main source, [人工智能&python_知识点整理.docx](docs/demo/人工智能&python_知识点整理.docx), is used to build an “Artificial Intelligence and Python” course knowledge base in the desktop app. It provides a practical baseline for courses in AI, computer science, and electronic information engineering.

| Course module | Topics covered |
| --- | --- |
| Python and data processing | Language fundamentals, NumPy, data representation, and programming practice |
| Machine learning | Linear and logistic regression, KNN, K-means, and Naive Bayes |
| Neural networks | Fully connected networks, CNNs, parameter calculations, and Keras practice |
| Knowledge and reasoning | Predicate logic, semantic networks, frame representation, and certainty reasoning |
| Search and optimization | State spaces, heuristic search, A*, and genetic algorithms |

The demo knowledge base has been used to generate a quiz, nine structured flashcards, a mind map, a coding lab, a course explanation, further reading, and a Chinese-language podcast. See the [demo data guide](docs/demo/README.md) for the complete list and reproduction notes, or [play the generated MP3](docs/demo/人工智能与Python专业课知识库-播客.mp3).

### Flashcards

![Flashcards generated from course sources](docs/assets/demo-flashcards.jpg)

### Podcast

![A course podcast with subtitles and playback controls](docs/assets/demo-podcast.jpg)

The demo podcast uses `mimo-v2.5-pro` for its outline and script, and `mimo-v2.5-tts` for speech synthesis. You can replace both models in Settings. No API keys are included in this repository.

## Quick start

### Windows desktop installer (recommended)

Download `ForgeNote-Setup-0.1.4.exe` from [Releases](../../releases/latest), run the installer, and launch ForgeNote from the desktop or Start menu. Docker, Python, and Node.js are not required. You can install a newer version over an existing installation.

On first launch, add provider credentials under Models. Then use Settings to select the models for general text, embeddings, images, TTS, STT, and each learning asset. See the [configuration guide](docs/configuration-guide.md) for details.

To build the installer yourself:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\windows\build.ps1
```

The installer is written to `dist/windows/ForgeNote-Setup-0.1.4.exe`. See the [Windows packaging guide](desktop/windows/README.md) for packaging and data-directory details.

### Run from source

Start the API:

```powershell
uv sync
uv run python run_api.py
```

In another terminal, start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

### Docker (optional)

```powershell
docker compose up -d --build
```

The Docker build downloads dependencies from Docker Hub, Debian, npm, and other external sources. On network-restricted Windows systems, use the desktop installer instead.

## Technology

- FastAPI, Next.js, SurrealDB, and a background command worker
- Source chunking, embeddings, BM25/semantic retrieval, and RAG
- OpenAI, OpenAI-compatible, DashScope, and Azure OpenAI protocol adapters
- A Windows WebView2 shell packaged with PyInstaller, Node.js, SurrealDB, and FFmpeg

Runtime identifiers use the project-owned `forgenote` Python package, `FORGENOTE_*` environment variables, and the `forgenote` database namespace.

## Verification

The project includes backend unit tests, frontend component tests, linting, production builds, Windows installer builds, and packaged-directory smoke tests. See the [testing guide](docs/testing.md) for the full test matrix and commands.

## Documentation

- [Requirements analysis](docs/requirements-analysis.md)
- [System design](docs/system-design.md)
- [Configuration guide](docs/configuration-guide.md)
- [Deployment and demo](docs/deployment-and-demo.md)
- [Open-source and AI tooling notes](docs/open-source-and-ai-tools.md)

ForgeNote is developed from the open-source [Open Notebook](https://github.com/lfnovo/open-notebook) project.
