# Use the official Node.js 22 image as the base image
FROM node:lts-alpine

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 8080

# Define the command to run the app
CMD ["npm", "start"]
