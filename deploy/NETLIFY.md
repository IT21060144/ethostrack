# Putting EthosTrack on Netlify

EthosTrack goes on a **new Netlify site of its own** (for example
`ethostrack-inoka.netlify.app`). Your research site stays as it is; you can
add a button on it that links to the app.

> **Why dragging a zip onto Netlify doesn't work:** dragging files onto
> Netlify only publishes web pages. EthosTrack also has a part that signs
> students in and saves their study time, and Netlify only sets that part up
> when it is published with the "Publish to Netlify" file below.

You need: your Mac, and free accounts at MongoDB Atlas and Netlify.

## Step 1. Make a free online database (MongoDB Atlas)

Your laptop's database can't be reached from the internet, so the website
needs its own.

1. Go to https://www.mongodb.com/cloud/atlas and sign up.
2. Create a cluster and choose the **Free** option.
3. It asks you to create a database user. Type a username and a password and
   **write the password down**. (Avoid `@`, `:` and `/` in the password.)
4. Go to **Network Access**, click **Add IP Address**, choose
   **Allow access from anywhere** and confirm. Netlify has no fixed address,
   so this is needed. The password still protects the data.
5. Go to **Database**, click **Connect**, then **Drivers**. Copy the text
   that starts with `mongodb+srv://`.
   Keep it ready. You don't need to change it: the publish window asks for
   your password separately and puts it in for you.

## Step 2. Double-click "Publish to Netlify.command"

It is in the EthosTracker folder. The first time, macOS may say it is from an
unidentified developer: right-click the file, choose **Open**, then **Open**
again.

A window opens and does four things:

1. **Signs in to Netlify.** A browser window opens: sign up or log in, click
   **Authorize**, then go back to the window.
2. **Makes a new Netlify site.** Pick your team with the arrow keys and press
   Enter, then type a name such as `ethostrack-inoka` and press Enter.
3. **Asks for your database address.** Paste the text from Step 1 and press
   Enter, then type your database password (it stays hidden) and press
   Enter. It makes the secret keys by itself.
4. **Builds and publishes.** This takes a minute or two.

## Step 3. See it working

When it finishes, your new website opens in the browser. You will see the
EthosTrack sign-in page. Create an account, leave the tab open, and the top
bar says **"Tracking your study time automatically."**

If something goes wrong, the window shows a message. Send me a photo or
copy of it.

## Updating the website later

After any change, double-click **Publish to Netlify.command** again. It
remembers the site and the settings and only publishes the new version.

Never delete or change the `PSEUDONYM_SECRET` setting in Netlify. It is the
key that links each student to their anonymous study data.

## Linking it from your research site

Add a button on your research site's Home section, next to "Explore the
research", that opens your new address, for example
`https://ethostrack-inoka.netlify.app`.

## What is different from the laptop version

- **Starting by itself when the laptop opens only works on the Mac.** A
  website cannot open a browser on a student's computer. On the website,
  tracking starts when the student opens the page and signs in, and continues
  while that tab stays open.
- **Only activity inside the EthosTrack tab counts.** The Mac version can also
  notice typing in other apps; a website is not allowed to see outside its own
  tab (which is also more private).
- The website starts with an empty database. The demo account
  (`student@example.com`) only exists on the laptop.
- Netlify's free plan has a monthly limit on function use. Each open,
  tracking tab uses a few function calls a minute, which is fine for a
  demonstration or a small group of students.

## For reference: doing it by hand

`npx netlify-cli login`, then `npx netlify-cli sites:create`, then set
`MONGO_URI`, `JWT_SECRET` and `PSEUDONYM_SECRET` under **Project
configuration > Environment variables**, then
`npx netlify-cli deploy --build --prod`.
