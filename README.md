# DERMAMIND
### AI-Powered Skin Lesion Screening and Analysis Platform

DERMAMIND is an AI-powered web application designed to assist with preliminary skin lesion screening through image analysis. It uses a Vision Transformer (ViT) model to classify skin lesions into seven categories and provides visual explanations using Explainable AI (XAI).

The platform combines AI-based image analysis with user authentication, patient profile management, screening history, multilingual voice assistance, and nearby healthcare facility search.

> **Disclaimer:** DERMAMIND is an educational and research project intended for preliminary screening purposes. It is not a medical diagnostic system and cannot replace professional medical advice or dermatological evaluation.

---

## Features

- **AI-Based Skin Lesion Classification:** Analyzes skin lesion images using a Vision Transformer (ViT) model.
- **Seven-Class Classification:** Classifies skin lesions into seven categories.
- **Image Quality Validation:** Evaluates uploaded images for suitability before analysis.
- **Explainable AI (XAI):** Generates heatmaps using Occlusion Sensitivity to visualize image regions influencing model predictions.
- **User Authentication:** Supports user registration and login using JWT authentication and password hashing.
- **Patient Profile Management:** Stores user profiles and emergency contact information.
- **Screening History:** Maintains previous screening records and associated images.
- **Multilingual Voice Assistant:** Provides voice-based assistance in multiple languages.
- **Nearby Hospital Search:** Helps users discover nearby healthcare facilities using Google Places API.
- **Emergency Contact Verification:** Supports OTP-based emergency contact verification through 2Factor.
- **Emergency Alert Demonstration:** Includes a demonstration workflow for emergency contact alerts.

## Technologies Used

| Category | Technologies |
|---|---|
| Frontend | HTML5, CSS3, JavaScript |
| Backend | Node.js, Express.js |
| Database | SQLite |
| Authentication | JWT, bcryptjs |
| AI Architecture | Vision Transformer (ViT) |
| AI Model Runtime | Transformers.js, ONNX |
| Explainable AI | Occlusion Sensitivity |
| Image Processing | Canvas API |
| External APIs | Google Places API, 2Factor, Resend |
| Development Tools | Git, GitHub, npm |

## AI Model

DERMAMIND uses the `sazio/skin-mole-vit-onnx` model, a Vision Transformer model fine-tuned on the HAM10000 skin-lesion dataset.

The model classifies images into seven categories:

1. Actinic Keratoses (AKIEC)
2. Basal Cell Carcinoma (BCC)
3. Benign Keratosis-like Lesions (BKL)
4. Dermatofibroma (DF)
5. Melanoma (MEL)
6. Melanocytic Nevi (NV)
7. Vascular Lesions (VASC)

The model runs in the browser using Hugging Face Transformers.js and ONNX-based inference. Its quantized version helps reduce model size and improve browser execution.

## Explainable AI (XAI)

DERMAMIND implements **Occlusion Sensitivity** to explain the model's predictions.

The technique temporarily hides different regions of an uploaded image and observes how the model's prediction changes.

Regions that have a greater influence on the prediction are highlighted in a heatmap.

This provides a visual explanation of which image regions influenced the AI model's output.

## Model Evaluation

The project includes an independent technical evaluation of the quantized ONNX model using 300 labeled HAM10000 test images.

### Overall Evaluation Results

| Evaluation Metric | Result |
|---|---:|
| Accuracy | 84.67% |
| Macro Precision | 84.23% |
| Macro Recall | 74.19% |
| Macro F1-Score | 74.63% |
| Weighted Precision | 89.46% |
| Weighted Recall | 84.67% |
| Weighted F1-Score | 84.13% |
| Macro ROC-AUC | 0.980 |

**Evaluation Notes:**

- Evaluation was performed on a sample of 300 labeled images.
- The test sample is relatively small and class-imbalanced.
- Some lesion categories have limited representation.
- These results represent technical model evaluation, not clinical validation.
- AI predictions should not be considered confirmed medical diagnoses.

Detailed evaluation results are available in `model-evaluation/evaluation-results.json`.

## Project Structure

```text
DERMAMIND/
│
├── dermamind/
│   ├── home.html
│   ├── index.html
│   ├── style.css
│   ├── home.css
│   ├── script.js
│   ├── auth.js
│   ├── api-client.js
│   ├── image-validation.js
│   ├── voice-assistant.js
│   ├── xai.js
│   ├── model-performance-data.js
│   ├── manifest.json
│   └── google-places-config.js
│
├── routes/
│   ├── auth.js
│   ├── profile.js
│   └── analyses.js
│
├── middleware/
│   └── require-auth.js
│
├── db/
│   └── database.js
│
├── utils/
│   ├── auth-utils.js
│   └── image-storage.js
│
├── model-evaluation/
│   ├── evaluate.js
│   ├── preprocess.js
│   ├── README.md
│   └── evaluation-results.json
│
├── data/
├── notification-server.js
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
├── AI_MODEL_INFO.md
├── GOOGLE_PLACES_SETUP.md
├── NOTIFICATION_SETUP.md
├── OTP_VERIFY_FIX_NOTES.md
├── WORKFLOW_TEST_REPORT.md
└── TODO.md
```

## Installation and Setup

### Prerequisites

- Node.js 22 or later
- npm (Node Package Manager)
- Git
- A modern web browser
- Required API credentials for external integrations

### 1. Clone the Repository

```bash
git clone https://github.com/satya-anusha-Nathipam/DERMAMIND.git
```

### 2. Navigate to the Project Directory

```bash
cd DERMAMIND
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the project root directory using `.env.example` as a reference.

Configure the required environment variables:

```env
NOTIFICATION_PORT=5050
NODE_ENV=development

TWOFACTOR_API_KEY=YOUR_2FACTOR_API_KEY

JWT_SECRET=YOUR_RANDOM_SECRET_KEY
JWT_EXPIRES_IN=7d

DB_PATH=./data/dermamind.db
```

Generate a secure JWT secret using:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Never upload your actual `.env` file or API credentials to GitHub.

### 5. Configure Google Places API

To enable nearby hospital and healthcare facility search:

1. Create a Google Cloud project.
2. Enable Google Places API (New).
3. Configure billing and API restrictions.
4. Add your API key to `dermamind/google-places-config.js` using a browser-restricted key.

Refer to `GOOGLE_PLACES_SETUP.md` for additional instructions.

### 6. Start the Backend Server

Run:

```bash
npm start
```

The backend server runs on port `5050` by default.

To check whether the server is running, open:

```text
http://localhost:5050/health
```

### 7. Launch the Frontend

Open the `dermamind` folder using a code editor.

Run `home.html` through a local development server such as the VS Code Live Server extension.

The frontend communicates with the backend at:

```text
http://localhost:5050
```

The AI model and its dependencies may require an internet connection for the initial download.

## Backend API Endpoints

The application provides the following backend endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/signup` | User registration |
| POST | `/auth/login` | User login |
| GET | `/auth/me` | Retrieve authenticated user |
| GET | `/profile` | Retrieve patient profile |
| PUT | `/profile` | Update patient profile |
| POST | `/analyses` | Save screening analysis |
| GET | `/analyses` | Retrieve screening history |
| GET | `/analyses/:id` | Retrieve an analysis |
| GET | `/analyses/:id/image` | Retrieve original image |
| GET | `/analyses/:id/heatmap` | Retrieve heatmap |
| DELETE | `/analyses/:id` | Delete an analysis |
| GET | `/health` | Check backend status |
| POST | `/send-contact-otp` | Send emergency contact OTP |
| POST | `/verify-contact-otp` | Verify emergency contact OTP |
| POST | `/notify-emergency` | Demonstration emergency alert workflow |

## Future Enhancements

- Improve classification performance across underrepresented lesion categories.
- Enhance image preprocessing and validation.
- Strengthen application security and data privacy.
- Improve healthcare facility discovery.
- Expand testing and deployment capabilities.
- Develop a more comprehensive notification system.

## Disclaimer

DERMAMIND is developed strictly for educational, research, and preliminary screening purposes.

It is not a medical diagnostic tool and must not be used as a substitute for professional medical advice, diagnosis, or treatment.

AI predictions may be inaccurate. Always consult a qualified dermatologist for proper medical evaluation.

## Author

Developed as an AI-powered healthcare technology project.

**GitHub:** [satya-anusha-Nathipam](https://github.com/satya-anusha-Nathipam)
