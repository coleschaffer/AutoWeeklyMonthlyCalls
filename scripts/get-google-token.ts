/**
 * Google OAuth Refresh Token Generator
 *
 * This script helps you get a refresh token for YouTube and Google Drive APIs.
 * Run this once locally to get your refresh token, then add it to Railway.
 *
 * Usage:
 *   1. Set your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
 *   2. Run: npx tsx scripts/get-google-token.ts
 *   3. Open the URL in your browser
 *   4. Grant permissions
 *   5. Copy the refresh token and add to Railway
 */

import http from 'http';
import { URL } from 'url';
import open from 'open';
import dotenv from 'dotenv';

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/oauth/callback';
const PORT = 3000;

// Scopes needed for YouTube upload and Google Drive
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive',
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌ Error: Missing credentials!\n');
  console.error('Please create a .env file with:');
  console.error('  GOOGLE_CLIENT_ID=your_client_id');
  console.error('  GOOGLE_CLIENT_SECRET=your_client_secret\n');
  process.exit(1);
}

// Build the authorization URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // Force consent to get refresh token

console.log('\n🔐 Google OAuth Refresh Token Generator\n');
console.log('=' .repeat(50));

// Create a temporary server to receive the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  if (url.pathname === '/oauth/callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>❌ Authorization Failed</h1>
            <p>Error: ${error}</p>
          </body>
        </html>
      `);
      console.error(`\n❌ Authorization failed: ${error}\n`);
      server.close();
      process.exit(1);
    }

    if (code) {
      try {
        // Exchange code for tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI,
          }),
        });

        const tokens = await tokenResponse.json() as {
          access_token?: string;
          refresh_token?: string;
          error?: string;
          error_description?: string;
        };

        if (tokens.error) {
          throw new Error(tokens.error_description || tokens.error);
        }

        if (!tokens.refresh_token) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; padding: 40px; text-align: center;">
                <h1>⚠️ No Refresh Token Received</h1>
                <p>This can happen if you've already authorized this app before.</p>
                <p>Go to <a href="https://myaccount.google.com/permissions">Google Account Permissions</a>,
                   remove access for this app, and try again.</p>
              </body>
            </html>
          `);
          console.error('\n⚠️ No refresh token received!');
          console.error('Go to https://myaccount.google.com/permissions');
          console.error('Remove access for this app, then run this script again.\n');
          server.close();
          process.exit(1);
        }

        // Success!
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>✅ Success!</h1>
              <p>Your refresh token has been generated.</p>
              <p>Check your terminal for the token.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);

        console.log('\n✅ Success! Here are your tokens:\n');
        console.log('=' .repeat(50));
        console.log('\n📋 GOOGLE_REFRESH_TOKEN (add this to Railway):\n');
        console.log(tokens.refresh_token);
        console.log('\n' + '=' .repeat(50));
        console.log('\n🔑 Access Token (for testing, expires in 1 hour):\n');
        console.log(tokens.access_token);
        console.log('\n' + '=' .repeat(50));
        console.log('\n✨ Next steps:');
        console.log('1. Copy the GOOGLE_REFRESH_TOKEN above');
        console.log('2. Add it to your Railway environment variables');
        console.log('3. You\'re all set!\n');

        server.close();
        process.exit(0);

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>❌ Token Exchange Failed</h1>
              <p>${errorMessage}</p>
            </body>
          </html>
        `);
        console.error(`\n❌ Token exchange failed: ${errorMessage}\n`);
        server.close();
        process.exit(1);
      }
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, async () => {
  console.log(`\n📡 Local server started on port ${PORT}`);
  console.log('\n🌐 Opening browser for Google authorization...\n');
  console.log('If browser doesn\'t open, visit this URL:\n');
  console.log(authUrl.toString());
  console.log('\n' + '=' .repeat(50));
  console.log('\nWaiting for authorization...\n');

  // Try to open browser
  try {
    await open(authUrl.toString());
  } catch {
    console.log('(Could not open browser automatically)');
  }
});

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\n\nCancelled by user.\n');
  server.close();
  process.exit(0);
});
