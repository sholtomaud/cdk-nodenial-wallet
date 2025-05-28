import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
// import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface StaticSiteStackProps extends cdk.StackProps {
  domainName: string;
  siteSubDomain: string;
  // wafRateLimit?: number;
}

export class StaticSiteStack extends cdk.Stack {
  public readonly blueS3Bucket: s3.Bucket;
  public readonly greenS3Bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: StaticSiteStackProps) {
    super(scope, id, props);

    const siteDomain = props.siteSubDomain + '.' + props.domainName;

    // const rateLimit = props.wafRateLimit ?? 500;

    // WAF v2 WebACL for CloudFront
    // const webAcl = new wafv2.CfnWebACL(this, 'WebACL', {
    //   name: 'SiteWebACL',
    //   scope: 'CLOUDFRONT',
    //   defaultAction: { allow: {} },
    //   visibilityConfig: {
    //     cloudWatchMetricsEnabled: true,
    //     metricName: 'webACLMetric',
    //     sampledRequestsEnabled: true,
    //   },
    //   rules: [
    //     {
    //       name: 'RateLimitRule',
    //       priority: 1,
    //       action: { block: {} },
    //       statement: {
    //         rateBasedStatement: {
    //           limit: rateLimit,
    //           aggregateKeyType: 'IP',
    //         },
    //       },
    //       visibilityConfig: {
    //         cloudWatchMetricsEnabled: true,
    //         metricName: 'RateLimitRuleMetric',
    //         sampledRequestsEnabled: true,
    //       },
    //     },
    //   ],
    // });


    // S3 bucket for static website hosting - Blue environment
    this.blueS3Bucket = new s3.Bucket(this, 'BlueS3Bucket', {
      bucketName: `blue-${siteDomain}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html', // or your preferred error document
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
      autoDeleteObjects: true, // NOT recommended for production code
    });

    // S3 bucket for static website hosting - Green environment
    this.greenS3Bucket = new s3.Bucket(this, 'GreenS3Bucket', {
      bucketName: `green-${siteDomain}`,
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

    // Grant OAI read access to the Blue S3 bucket
    blueS3Bucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [blueS3Bucket.arnForObjects('*')],
      principals: [new iam.CanonicalUserPrincipal(oai.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
    }));

    // Grant OAI read access to the Green S3 bucket
    greenS3Bucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [greenS3Bucket.arnForObjects('*')],
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
    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultRootObject: 'index.html',
      domainNames: [siteDomain],
      certificate: certificate,
    // Associate WAF
    // webAclId: webAcl.attrArn,

      defaultBehavior: {
        origin: new origins.S3Origin(blueS3Bucket, { originAccessIdentity: oai }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      additionalBehaviors: {
        // This is a placeholder. In a real blue/green setup, you'd have a way to switch
        // origins, possibly by updating this configuration or using Lambda@Edge.
        // For now, we're just adding the green origin.
      },
      // Adding Green origin
      // Note: This doesn't automatically route traffic to green.
      // It just makes CloudFront aware of this origin.
      // Switching traffic would be a separate step (e.g., updating defaultBehavior.origin).
      origins: [
        new origins.S3Origin(greenS3Bucket, {
          id: 'greenOrigin', // Optional: specify an ID for this origin
          originAccessIdentity: oai,
        }),
        // The default origin (blueS3Bucket) also needs to be listed here if we specify `origins`
        // However, if defaultBehavior.origin is set, it's implicitly the primary origin.
        // For clarity and to avoid potential issues if `defaultBehavior.origin` was not set first,
        // it's often good practice to list all origins here.
        // But given the current structure, origins.S3Origin(blueS3Bucket, { originAccessIdentity: oai })
        // is already defined in defaultBehavior.
        // Let's try without explicitly adding blue here to keep it cleaner,
        // as it's defined in defaultBehavior. If CDK complains, we'll add it.
      ],
    });

    // A record in Route 53 to point the custom domain to the CloudFront distribution
    new route53.ARecord(this, 'SiteARecord', {
      recordName: siteDomain,
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new cdk.aws_route53_targets.CloudFrontTarget(distribution)),
    });

    // Output the CloudFront distribution URL
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
    });

    // Output the CloudFront Distribution ID
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
    });

    // Output the Blue S3 bucket name
    new cdk.CfnOutput(this, 'BlueBucketName', {
      value: this.blueS3Bucket.bucketName,
    });

    // Output the Green S3 bucket name
    new cdk.CfnOutput(this, 'GreenBucketName', {
      value: this.greenS3Bucket.bucketName,
    });

     // Output the site URL
     new cdk.CfnOutput(this, 'SiteUrl', {
      value: 'https://' + siteDomain,
    });
  }
}
