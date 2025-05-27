import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
// import * as wafv2 from 'aws-cdk-lib/aws-wafv2'; // Removed WAF
import { Construct } from 'constructs';

export interface StaticSiteStackProps extends cdk.StackProps {
  domainName: string;
  siteSubDomain: string;
  // wafRateLimit?: number; // Removed WAF
}

export class StaticSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StaticSiteStackProps) {
    super(scope, id, props);

    const siteDomain = props.siteSubDomain + '.' + props.domainName;
    // const rateLimit = props.wafRateLimit ?? 500; // Removed WAF

    // WAF v2 WebACL for CloudFront - REMOVED
    // const webAcl = new wafv2.CfnWebACL(this, 'WebACL', { ... });

    // S3 bucket for static website hosting
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: siteDomain,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html', // or your preferred error document
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
      autoDeleteObjects: true, // NOT recommended for production code
    });

    // Origin Access Identity (OAI) to restrict direct S3 bucket access
    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for ${siteDomain}`
    });

    // Grant OAI read access to the S3 bucket
    siteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [siteBucket.arnForObjects('*')],
      principals: [new iam.CanonicalUserPrincipal(oai.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
    }));

    // Look up existing Route 53 Hosted Zone
    // For CI/CD: Attempt to get zone info from CDK context, otherwise use placeholders/props.
    // Values can be passed to cdk deploy/synth via --context hostedZoneId=YOUR_ID --context zoneName=YOUR_ZONENAME
    const contextHostedZoneId = this.node.tryGetContext('hostedZoneId') || 'Z0123456789ABCDEFGHIJ'; // Fallback placeholder
    const contextZoneName = this.node.tryGetContext('zoneName') || props.domainName; // Fallback to props.domainName

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: contextHostedZoneId,
      zoneName: contextZoneName,
    });

    // ACM certificate for the custom domain (must be in us-east-1)
    const certificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
      domainName: siteDomain,
      hostedZone,
      region: 'us-east-1', // CloudFront requires certificates in us-east-1
    });

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultRootObject: 'index.html',
      domainNames: [siteDomain],
      certificate: certificate,
      // Associate WAF - REMOVED
      // webAclId: webAcl.attrArn,
      defaultBehavior: {
        origin: new origins.S3Origin(siteBucket, { originAccessIdentity: oai }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
    });

    // A record in Route 53 to point the custom domain to the CloudFront distribution
    new route53.ARecord(this, 'SiteARecord', {
      recordName: siteDomain,
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new cdk.aws_route53_targets.CloudFrontTarget(distribution)),
    });

    // Output the CloudFront distribution URL
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
    });

     // Output the site URL
     new cdk.CfnOutput(this, 'SiteUrl', {
      value: 'https://' + siteDomain,
    });
  }
}
