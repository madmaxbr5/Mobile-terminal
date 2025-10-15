# Mobile Terminal

A mobile-friendly web app for remotely accessing your VS Code terminal from your phone.

## Features

- **File Explorer**: Browse your file system with a mobile-optimized interface
- **Terminal**: Full terminal access with xterm.js
- **File Preview**: View text files and images
- **Task Queue**: Queue and execute Claude Code commands
- **Mobile Responsive**: Optimized for mobile devices

## Setup

### Server

```bash
cd server
npm install
npm start
```

### Client

```bash
cd client
npm install
npm start
```

## Usage

1. Start the server on your desktop machine
2. Open http://[your-machine-ip]:3000 on your mobile device
3. Navigate using the three tabs:
   - Files: Browse and select files
   - Terminal: Access your terminal
   - Preview: View selected files

## Security Note

This app currently runs without authentication. For production use:
- Add authentication/authorization
- Use HTTPS
- Configure firewall rules
- Consider using a VPN