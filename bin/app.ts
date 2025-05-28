#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StaticSiteStack } from '../lib/static-site-stack';
import { PipelineStack } from '../lib/pipeline-stack'; // Import PipelineStack

const app = new cdk.App();

// Replace with your domain name and desired subdomain
const domainName = 'example.com'; // Example: 'yourdomain.com'
const siteSubDomain = 'www';      // Example: 'www' or 'app'

const account = process.env.CDK_DEFAULT_ACCOUNT || '123456789012'; // Placeholder Account ID
const staticSiteRegion = 'us-east-1'; // CloudFront certificates typically require us-east-1
const pipelineRegion = process.env.CDK_DEFAULT_REGION || 'us-east-2'; // Or your primary operational region

const staticSiteStack = new StaticSiteStack(app, 'StaticSiteStack', {
  env: {
    account: account,
    region: staticSiteRegion,
  },
  domainName: domainName,
  siteSubDomain: siteSubDomain,
  description: `Static site hosting for ${siteSubDomain}.${domainName}`,
  // wafRateLimit: 1000, // Optional: Uncomment and set if WAF is used
});

// Instantiate PipelineStack
new PipelineStack(app, 'StaticSitePipelineStack', {
  env: {
    account: account,
    region: pipelineRegion, // Pipeline stack can be in a different region
  },
  domainName: domainName,
  siteSubDomain: siteSubDomain,
  blueS3BucketName: staticSiteStack.blueS3Bucket.bucketName,
  greenS3BucketName: staticSiteStack.greenS3Bucket.bucketName,
  distributionId: staticSiteStack.distribution.distributionId,
  description: `CI/CD Pipeline for ${siteSubDomain}.${domainName}`,
});

app.synth();