# Connect SecureShare to GitHub

Project path: C:\Users\fujai\Projects\SecureShare (branch: main)

## Option A - GitHub website

1. https://github.com/new - name: SecureShare, empty repo
2. Run:

cd $env:USERPROFILE\Projects\SecureShare
git remote add origin https://github.com/YOUR_USERNAME/SecureShare.git
git push -u origin main

## Option B - GitHub CLI

gh auth login
cd $env:USERPROFILE\Projects\SecureShare
gh repo create SecureShare --public --source=. --remote=origin --push
