#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StaticSiteStack } from '../lib/static-site-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

const app = new cdk.App();

// Apply CDK Nag checks
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

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

// Instantiate PipelineStack and assign to a variable
const pipelineStack = new PipelineStack(app, 'StaticSitePipelineStack', {
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

// Add NagSuppressions for StaticSiteStack
NagSuppressions.addStackSuppressions(staticSiteStack, [
  { 
    id: 'AwsSolutions-S1', 
    reason: 'Static site hosting bucket. Server access logs are not required for this example.' 
  },
  { 
    id: 'AwsSolutions-CFR1', 
    reason: 'CloudFront distribution does not require geo-restriction for this example.' 
  },
  { 
    id: 'AwsSolutions-CFR2', 
    reason: 'CloudFront distribution does not require WAF for this example (WAF is optional and not enabled by default in the StaticSiteStack).' 
  },
  { 
    id: 'AwsSolutions-CFR4', 
    reason: 'CloudFront distribution uses the default certificate, which is acceptable for this example.' 
  },
  {
    id: 'AwsSolutions-IAM4',
    reason: 'OAI identity uses AWS managed policy CloudFrontOriginAccessIdentityPolicy, which is standard and specific to OAI.'
  }
]);

// Add NagSuppressions for PipelineStack
NagSuppressions.addStackSuppressions(pipelineStack, [
  { 
    id: 'AwsSolutions-IAM5', 
    reason: 'Pipeline and CodeBuild roles require permissions that may include wildcards for resource deployment (e.g., S3, CloudFormation) and artifact access. These are standard for CDK-generated pipeline roles and CodeBuild projects managing infrastructure or S3 deployments.' 
  },
  { 
    id: 'AwsSolutions-IAM4', 
    reason: 'Pipeline and CodeBuild roles may use AWS managed policies (e.g., for S3 access, CodeBuild basic permissions), which are standard and necessary for their function.' 
  },
  {
    id: 'AwsSolutions-CB3',
    reason: 'CodeBuild projects for CDK synth/deployment and other pipeline tasks do not require KMS encryption for artifacts for this example setup.'
  },
  {
    id: 'AwsSolutions-CB4',
    reason: 'CodeBuild projects for CloudFront invalidation and origin update operate on AWS services and do not require VPC access for this example.'
  }
]);

app.synth();