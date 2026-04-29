# SpecsPlay

**SpecsPlay** is an AI-powered AR lens for Spectacles that generates music from your surroundings using Google Lyria. Simply tap your wrist-mounted settings menu to select your preferred music style, and SpecsPlay generates a unique track tailored to your environment in real-time.

## 🎵 Features

- **AI-Powered Music Generation**: Uses Google Lyria API to generate unique, contextual music
- **Wrist-Mounted Control Panel**: Easily accessible settings menu on your left wrist (accessed via wrist tap)
- **Library Management**: Browse and replay generated songs with an intuitive scrollable library
- **Model Selection**: Choose between Lyria Clip and Lyria Pro models for different generation quality levels
- **Proximity-Based Feedback**: Watch icon highlights when your hand approaches the settings button
- **Real-Time Streaming**: Stream generated audio directly to your AR experience

## 📋 System Requirements

- **Snapchat Spectacles** (Gen 4 or later)
- **Lens Studio** (latest version)
- **Node.js 16+** (for backend server)
- **Docker & Docker Compose** (optional, for production deployment)

## 🚀 Quick Start

### 1. Local Development Setup

#### Clone the Repository
```bash
git clone git@github.com:nigelhartman/SpecsPlay.git
cd SpecsPlay
```

#### Set Up Environment Variables
```bash
# Copy the example .env file
cp .env.example .env

# Edit .env and add your API keys
nano .env
```

In `.env`, configure:
- `GEMINI_API_KEY`: Your Google Gemini API key
- `OPENROUTER_API_KEY`: (Optional) OpenRouter API key for alternative providers
- `BASE_URL`: Set to `http://localhost:3000` for local development
- `SECRET_KEY`: Any random string for session security

**Getting API Keys:**
- **Gemini API**: Get your free key from [Google AI Studio](https://aistudio.google.com/app/apikey)
- **OpenRouter API**: (Optional) Sign up at [OpenRouter.ai](https://openrouter.ai)

#### Start the Backend Server
```bash
cd backend
npm install
npm start
```

The server will run on `http://localhost:3000`.

### 2. Lens Studio Setup

#### Import the Project
1. Open **Lens Studio**
2. Select **File → Open Project**
3. Navigate to the `SpecsPlay.esproj` file in this repository
4. Click **Open**

#### Configure the Backend URL (Local Development)
1. In Lens Studio, open the **Scene** (`Assets/Scene.scene`)
2. Select the **LyriaMusicController** component
3. Update the `apiBaseUrl` to point to your local backend:
   - For local testing: `http://localhost:3000`
   - For production: `https://your-deployed-domain.com`

#### Test in Preview
1. Click **Preview** in Lens Studio to test the lens locally
2. Tap the watch icon on your left wrist to open the settings menu
3. Select a music style from the Library
4. The lens will generate and stream music

#### Deploy to Device
1. Use Lens Studio's **Build & Test** feature to deploy to your Spectacles
2. Ensure your device is connected to the same network as your backend

### 3. Production Deployment (Optional)

#### Deploy with Docker
The project includes Docker configuration for easy deployment:

```bash
# Update deploy.sh with your server details
nano deploy.sh

# Deploy to your server
sh deploy.sh
```

**Server Requirements:**
- Ubuntu 20.04+ or similar Linux distribution
- SSH access configured
- Docker and Docker Compose installed
- Public domain with SSL certificate (via Caddy)

## 📁 Project Structure

```
SpecsPlay/
├── Assets/
│   ├── Scripts/
│   │   ├── SettingsUIController.ts      # Main UI panel for library & settings
│   │   ├── LyriaMusicController.ts      # Backend API communication
│   │   ├── WristWatchController.ts      # Wrist button interaction
│   │   └── RadialMenuController.ts      # Radial UI menu
│   ├── Scene.scene                       # Main AR scene
│   ├── Material/                         # UI materials and styling
│   └── Images/                           # UI icons and assets
├── backend/
│   ├── server.js                         # Node.js API server
│   ├── package.json                      # Node dependencies
│   ├── Dockerfile                        # Docker configuration
│   ├── docker-compose.yml                # Multi-container setup
│   └── Caddyfile                         # Reverse proxy & SSL configuration
├── .env.example                          # Environment variable template
├── .env                                  # Environment variables (not shared)
├── deploy.sh                             # Production deployment script
└── README.md                             # This file
```

## 🔧 Configuration

### Backend Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes* | Google Gemini API key for music generation |
| `OPENROUTER_API_KEY` | Yes* | OpenRouter API key (alternative to Gemini) |
| `BASE_URL` | No | Base URL for API (default: `http://localhost:3000`) |
| `SECRET_KEY` | No | Session secret key |
| `PORT` | No | Backend server port (default: `3000`) |

*At least one API key is required.

### Lens Configuration

Update these constants in `Assets/Scripts/SettingsUIController.ts` for UI customization:

- `PANEL_DIST`: Distance of UI panel from viewer (default: 45)
- `FRAME_SIZE`: Size of the UI frame
- `BUTTON_SCALE`: Scale of interactive buttons

## 🎮 User Guide

### Accessing Settings
1. **Rotate your left wrist** so the back of your hand faces the camera
2. **Tap the watch icon** (⚙ symbol) that appears on your dorsal wrist
3. The settings panel will appear in front of you

### Generating Music
1. Select a **music style** from the Library tab
2. The app generates a unique track based on your selection
3. Music streams directly to your audio output

### Switching Models
1. Open the **Settings tab** in the control panel
2. Choose between:
   - **Lyria Clip**: Faster generation, suitable for real-time use
   - **Lyria Pro**: Higher quality, longer generation time
3. Selection is saved for your next session

## 📹 Demo Video

[Video Demo Coming Soon - Click here to add video]

## 🔐 Security & Privacy

- **API Keys**: Never commit `.env` to version control. Add to `.gitignore` (already configured)
- **HTTPS**: Production deployments use automatic SSL via Caddy
- **Audio Files**: Temporary generated files are deleted after 10 minutes
- **No User Data**: The app doesn't store personal information

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 Credits

### Libraries & Tools
- **Lens Studio**: Snapchat's AR development platform
- **SpectaclesUIKit**: UI component library
- **SpectaclesInteractionKit**: Hand tracking and gesture detection
- **Google Lyria**: AI music generation API

### Icons
- <a href="https://www.flaticon.com/free-icons/multimedia" title="multimedia icons">Multimedia icons created by Those Icons - Flaticon</a> (Play button)
- <a href="https://www.flaticon.com/free-icons/pause" title="pause icons">Pause icons created by Kiranshastry - Flaticon</a> (Pause button)
- <a href="https://www.flaticon.com/free-icons/previous-track" title="previous track icons">Previous track icons created by Nsu Rabo Elijah - Flaticon</a> (Restart button)
- <a href="https://www.flaticon.com/free-icons/ui" title="ui icons">Ui icons created by Yudhi Restu - Flaticon</a> (Settings icon)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Troubleshooting

### Backend Connection Issues
- Verify `BASE_URL` in your Lens code matches your backend URL
- Check firewall rules allow connections on your API port
- Ensure backend server is running (`npm start` in `/backend`)

### Music Generation Fails
- Check API key validity in `.env`
- Verify API rate limits haven't been exceeded
- Check backend logs: `docker compose logs -f` (for Docker deployments)

### Spectacles Connection Issues
- Ensure device and development machine are on the same network
- Verify Lens Studio preview is running
- Check Spectacles are properly paired in Lens Studio

---

**Questions or Issues?** Open an issue on [GitHub](https://github.com/nigelhartman/SpecsPlay/issues)
