#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StaticSiteStack } from '../lib/static-site-stack';

const app = new cdk.App();

// Replace with your domain name and desired subdomain
const domainName = 'example.com';
const siteSubDomain = 'www';

new StaticSiteStack(app, 'StaticSiteStack', {
  env: {
    // Ensure you specify the account and region for the stack
    // For ACM certificate validation in us-east-1 and Route53 hosted zone lookup
    // Using placeholder values if environment variables are not set,
    // as CDK context lookups require these at synth time.
    // Replace these with your actual account and region or ensure
    // CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION are set in your environment.
    account: process.env.CDK_DEFAULT_ACCOUNT || '123456789012', // Placeholder Account ID
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',   // Placeholder Region
  },
  domainName: domainName,
  siteSubDomain: siteSubDomain,
  description: `Static site hosting for ${siteSubDomain}.${domainName}`,
  // wafRateLimit: 1000,
});

app.synth();