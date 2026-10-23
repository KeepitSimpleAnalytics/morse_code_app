# 📻 Morse Code Trainer

A comprehensive web-based morse code training application designed to help you learn CW (Continuous Wave) effectively. Features multiple practice modes, adjustable speeds measured in WPM (Words Per Minute), and the proven Koch method for progressive learning.

## Features

### Practice Modes
- **Koch Method**: Progressive training starting with the most distinct characters
- **Random Letters**: Practice with random character sequences
- **Common Words**: Train with frequently used English words
- **Callsigns**: Practice amateur radio callsign patterns
- **Q-Codes**: Learn standard radio Q-codes
- **Custom Text**: Enter your own practice material

### Speed Controls
- **Character Speed (WPM)**: Control how fast individual characters are sent (5-40 WPM)
- **Effective Speed (WPM)**: Set slower overall speed using Farnsworth timing (5-40 WPM)
- **Tone Frequency**: Adjustable audio frequency (400-1000 Hz)
- **Actual WPM indicator**: Shows the real transmit rate and whether Farnsworth spacing is active

### Learning Features
- Visual feedback showing dots and dashes as they play
- Answer checking with scoring system
- Session statistics tracking
- Progressive Koch method with automatic level advancement at 90% accuracy
- Farnsworth timing for proper character formation learning
- **Automatic progress saving** - your settings and statistics persist across browser sessions

## Quick Start with Docker

### Prerequisites
- Docker
- Docker Compose

### Running the Application

1. **Clone or download this directory**

2. **Build and run with Docker Compose**:
```bash
docker-compose up -d
```

3. **Access the application**:
Open your browser to `http://localhost:8081`

4. **Stop the application**:
```bash
docker-compose down
```

### Building the Docker Image Manually

```bash
docker build -t morse-code-trainer .
docker run -d -p 8080:80 morse-code-trainer
```

### Sharing the Docker Image

**Save the image to a file**:
```bash
docker save morse-code-trainer:latest | gzip > morse-code-trainer.tar.gz
```

**Load the image on another machine**:
```bash
docker load < morse-code-trainer.tar.gz
docker run -d -p 8080:80 morse-code-trainer
```

## Learning Morse Code Effectively

### 1. Start with the Koch Method ✅
The Koch method introduces characters progressively, starting with the most distinct patterns:
- **K, M** (Level 1) - Most distinct sounds
- Gradually adds more characters as you achieve 90%+ accuracy
- Never practice all 26 letters at once!

### 2. Always Practice at Full Speed (15+ WPM) 🚀
**Critical Rule**: Never practice character formations slower than 15 WPM!
- Slow character speeds (5-10 WPM) teach you to count dots and dashes (wrong!)
- Use **Farnsworth spacing** instead: fast characters, slow word spacing
- Example: 20 WPM characters, 15 WPM effective speed

### 3. Listen for Sound Patterns, Not Dots/Dashes 🎵
- Each character has a unique "melody" or rhythm
- The letter **K** sounds like "DAH-dit-DAH" (not "dash dot dash")
- **M** sounds like "DAH-DAH"
- **R** sounds like "dit-DAH-dit"
- Train your brain to recognize these sound patterns

### 4. Practice Schedule 📅
- **15-20 minutes daily** is better than occasional long sessions
- Consistency is key for building neural pathways
- Take breaks if you feel frustrated

### 5. Progression Guidelines 📊
- Master 90%+ accuracy before advancing
- If accuracy drops below 70%, go back a level
- Don't rush - solid fundamentals are essential

### 6. Additional Practice Tips 💡
- Start with **random characters** to avoid word prediction
- Progress to **common words** for practical application
- Practice **callsigns** if interested in amateur radio
- Learn **Q-codes** for standard radio communications
- Use **custom text** for specific phrases you need

## Using the Application

### Koch Method (Recommended for Beginners)
1. Select "Koch Method" mode
2. Set Character Speed to 20 WPM
3. Set Effective Speed to 15 WPM (or lower)
4. Click "Play New Message"
5. Listen carefully and type what you hear
6. Check your answer
7. Achieve 90%+ accuracy to unlock the next level

### Speed Settings Explained
- **Character Speed**: How fast individual letters are sent
  - Start at 18-20 WPM minimum
  - This teaches proper character "melody"
  - While the speeds are linked (default), moving this slider also adjusts Effective Speed so the **Actual WPM** matches

- **Effective Speed**: Overall message speed with spacing
  - Can be slower than character speed (Farnsworth timing)
  - Extra spacing between characters and words
  - Start at 12-15 WPM, gradually increase
  - Drag this slider below the character speed to enable Farnsworth spacing; bring it back up to re-link both speeds and return to full-rate practice

### Farnsworth Timing
When Effective Speed < Character Speed:
- Characters sent at full Character Speed
- Extra spacing added between characters and words
- Allows learning proper character formation at slower overall pace
- Essential for beginners!

## Technical Details

### Technologies Used
- Pure HTML5, CSS3, JavaScript (no frameworks)
- Web Audio API for morse code generation
- Nginx for serving static files
- Docker for containerization

### WPM Calculation
Based on the "PARIS" standard:
- One word = 50 dot units
- PARIS = 50 units (10 dots + 4 dashes + 9 gaps + word spaces)
- WPM = 1200 / dot_duration_ms

### Timing Standards
- **Dot**: 1 unit
- **Dash**: 3 units
- **Intra-character gap**: 1 unit
- **Character gap**: 3 units (+ Farnsworth extra)
- **Word gap**: 7 units (+ Farnsworth extra)

## Troubleshooting

### No audio playing
- Check browser audio permissions
- Increase system volume
- Try clicking "Play New Message" after page loads (some browsers require user interaction)

### Audio clicks or pops
- This is normal for very fast speeds (30+ WPM)
- Try adjusting the tone frequency
- The app uses audio envelopes to minimize clicks

### Docker container won't start
```bash
# Check if port 8080 is already in use
docker ps
netstat -an | grep 8080

# Use a different port
docker run -d -p 8081:80 morse-code-trainer
```

## Contributing

Feel free to modify and enhance this application:
- Add more practice modes
- Implement prosigns (AR, SK, BT, etc.)
- Add keyboard shortcuts
- Include achievement badges

## Resources

### Further Learning
- [ARRL Morse Code Learning Resources](http://www.arrl.org/learning-morse-code)
- [Long Island CW Club Koch Method Trainer](http://lcwo.net/)
- [CW Academy](https://cwops.org/cw-academy/)

### Amateur Radio
If learning morse for amateur radio:
- Study for your license at [hamstudy.org](https://hamstudy.org/)
- Join [CWops](https://cwops.org/) for CW training and practice
- Practice with other operators on-air!

## License

This is a learning tool created for educational purposes. Use freely and modify as needed.

---

**Good luck with your morse code journey! 73 (Best regards in morse code)** 📻✨
