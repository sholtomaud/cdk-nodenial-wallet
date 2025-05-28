import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
// Assuming StaticSiteStackProps might be needed or a subset of it.
// For now, we'll define what's directly required by the pipeline.
// import { StaticSiteStackProps } from './static-site-stack'; // If needed

export interface PipelineStackProps extends cdk.StackProps {
  // Props from StaticSiteStack or specific values needed for pipeline
  // For now, let's assume we pass specific resource names/IDs
  blueS3BucketName: string;
  greenS3BucketName: string;
  distributionId: string;
  domainName: string;
  siteSubDomain: string;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    // --- IAM Roles for CodeBuild Projects ---

    // Role for CloudFront Invalidation CodeBuild projects
    const invalidateCloudFrontRole = new iam.Role(this, 'InvalidateCloudFrontRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      inlinePolicies: {
        CloudFrontInvalidationPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['cloudfront:CreateInvalidation'],
              resources: [`arn:aws:cloudfront::${this.account}:distribution/${props.distributionId}`],
            }),
          ],
        }),
      },
    });

    // Role for Update CloudFront Origin CodeBuild project
    const updateCloudFrontOriginRole = new iam.Role(this, 'UpdateCloudFrontOriginRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      inlinePolicies: {
        CloudFrontUpdatePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'cloudfront:GetDistributionConfig',
                'cloudfront:UpdateDistribution',
              ],
              resources: [`arn:aws:cloudfront::${this.account}:distribution/${props.distributionId}`],
            }),
          ],
        }),
      },
    });
    
    // --- Source Stage ---
    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: 'GitHub_Source',
      owner: 'GITHUB_OWNER', // Placeholder
      repo: 'GITHUB_REPO',   // Placeholder
      branch: 'main',
      connectionArn: 'CONNECTION_ARN', // Placeholder for CodeStar Connection ARN
      output: sourceOutput,
    });

    // --- Build Stage ---
    const cdkOutputArtifact = new codepipeline.Artifact('CdkOutputArtifact');
    const siteOutputArtifact = new codepipeline.Artifact('SiteOutputArtifact');

    const buildProject = new codebuild.PipelineProject(this, 'CdkBuildProject', {
      projectName: 'PipelineBuildProject',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: 'npm ci',
          },
          build: {
            commands: [
              'npx cdk synth',
              'echo "No site build step defined, assuming \'site/\' contains final static files."',
              // 'npm run build-site', // Example placeholder for site build
            ],
          },
        },
        artifacts: {
          'base-directory': 'cdk.out',
          files: '**/*',
          name: 'CdkOutputArtifact', // Corresponds to primary artifact
        },
        'secondary-artifacts': {
          SiteOutputArtifact: { // This name must match the artifact name used in S3DeployAction
            'base-directory': 'site',
            files: '**/*',
          },
        },
      }),
      // The primary output artifact name is derived from the buildspec's 'artifacts.name'
      // or if not specified, it's the project name. Here we are explicit.
      // Secondary artifacts are defined in buildspec and referenced by their given name.
    });

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CDK_Build',
      project: buildProject,
      input: sourceOutput,
      outputs: [cdkOutputArtifact, siteOutputArtifact], // Explicitly define both artifacts
    });

    // --- DeployBlue Stage ---
    // Action 1: Deploy Infrastructure (Optional for this specific blue/green file deployment focus)
    // This assumes StaticSiteStack is the name of your stack defined in your cdk app.
    // The template file name should match how CDK generates it (usually StackName.template.json)
    const deployInfraAction = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
        actionName: 'DeployInfrastructure',
        stackName: 'StaticSiteStack', // Or make this dynamic if needed
        templatePath: cdkOutputArtifact.atPath('StaticSiteStack.template.json'),
        adminPermissions: true, // Be cautious with this in production
        runOrder: 1,
    });
    
    // Action 2: Deploy to Blue S3 Bucket
    const deployToBlueAction = new codepipeline_actions.S3DeployAction({
      actionName: 'DeployToBlueBucket',
      bucket: s3.Bucket.fromBucketName(this, 'ImportedBlueBucket', props.blueS3BucketName),
      input: siteOutputArtifact,
      extract: true,
      runOrder: 2,
    });

    // Action 3: Invalidate CloudFront for Blue
    const invalidateCloudFrontBlueProject = new codebuild.PipelineProject(this, 'InvalidateCloudFrontBlueProject', {
      projectName: 'InvalidateCloudFrontBlueProject',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              `aws cloudfront create-invalidation --distribution-id ${props.distributionId} --paths "/*"`,
            ],
          },
        },
      }),
      role: invalidateCloudFrontRole, // Assign the specific role
    });

    const invalidateBlueAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'InvalidateCloudFrontBlue',
      project: invalidateCloudFrontBlueProject,
      input: siteOutputArtifact, // Needs an input, though not strictly used by this buildspec
      runOrder: 3,
    });

    // --- DeployGreen Stage ---
    const approveGreenDeploymentAction = new codepipeline_actions.ManualApprovalAction({
      actionName: 'ApproveGreenDeployment',
      runOrder: 1,
    });

    const deployToGreenAction = new codepipeline_actions.S3DeployAction({
      actionName: 'DeployToGreenBucket',
      bucket: s3.Bucket.fromBucketName(this, 'ImportedGreenBucket', props.greenS3BucketName),
      input: siteOutputArtifact,
      extract: true,
      runOrder: 2,
    });

    const invalidateCloudFrontGreenProject = new codebuild.PipelineProject(this, 'InvalidateCloudFrontGreenProject', {
        projectName: 'InvalidateCloudFrontGreenProject',
        environment: {
            buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
        },
        buildSpec: codebuild.BuildSpec.fromObject({
            version: '0.2',
            phases: {
                build: {
                    commands: [
                        `aws cloudfront create-invalidation --distribution-id ${props.distributionId} --paths "/*"`,
                    ],
                },
            },
        }),
        role: invalidateCloudFrontRole, // Re-use the same role
    });

    const invalidateGreenAction = new codepipeline_actions.CodeBuildAction({
        actionName: 'InvalidateCloudFrontGreen',
        project: invalidateCloudFrontGreenProject,
        input: siteOutputArtifact, // Needs an input
        runOrder: 3,
    });

    // --- PromoteToGreen Stage ---
    const approvePromoteToGreenAction = new codepipeline_actions.ManualApprovalAction({
      actionName: 'ApprovePromoteToGreen',
      runOrder: 1,
    });

    const updateCloudFrontOriginProject = new codebuild.PipelineProject(this, 'UpdateCloudFrontOriginProject', {
      projectName: 'UpdateCloudFrontOriginProject',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              `ETAG=$(aws cloudfront get-distribution-config --id "${props.distributionId}" --query 'ETag' --output text)`,
              `JSON_CONFIG_STR=$(aws cloudfront get-distribution-config --id "${props.distributionId}" --query 'DistributionConfig' --output json)`,
              // Ensure GREEN_ORIGIN_ID is correctly passed and used.
              // The green S3 origin was created with id: 'greenOrigin' in static-site-stack.ts
              `UPDATED_CONFIG_STR=$(echo "$JSON_CONFIG_STR" | jq --arg greenOriginId "${process.env.GREEN_ORIGIN_ID}" '.DefaultCacheBehavior.TargetOriginId = $greenOriginId')`,
              `aws cloudfront update-distribution --id "${props.distributionId}" --if-match "$ETAG" --distribution-config "$UPDATED_CONFIG_STR"`,
            ],
          },
        },
      }),
      environmentVariables: {
        // DISTRIBUTION_ID is implicitly available via props.distributionId in commands
        // GREEN_BUCKET_NAME: { value: props.greenS3BucketName }, // Not directly used in the simplified jq command
        GREEN_ORIGIN_ID: { value: 'greenOrigin' }, // This MUST match the ID of the green S3 origin in CloudFront
      },
      role: updateCloudFrontOriginRole, // Assign the specific role
    });

    const updateCloudFrontOriginAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'UpdateCloudFrontOriginToGreen',
      project: updateCloudFrontOriginProject,
      input: cdkOutputArtifact, // Needs an input, CdkOutputArtifact is arbitrary here
      runOrder: 2,
    });
    
    const invalidatePostPromotionProject = new codebuild.PipelineProject(this, 'InvalidateCloudFrontPostPromotionProject', {
        projectName: 'InvalidateCloudFrontPostPromotionProject',
        environment: {
            buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
        },
        buildSpec: codebuild.BuildSpec.fromObject({
            version: '0.2',
            phases: {
                build: {
                    commands: [
                        `aws cloudfront create-invalidation --distribution-id ${props.distributionId} --paths "/*"`,
                    ],
                },
            },
        }),
        role: invalidateCloudFrontRole, // Re-use the same role
    });

    const invalidatePostPromotionAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'InvalidateCloudFrontPostPromotion',
      project: invalidatePostPromotionProject,
      input: siteOutputArtifact, // Needs an input
      runOrder: 3,
    });

    // --- Define Pipeline ---
    new codepipeline.Pipeline(this, 'StaticSitePipeline', {
      pipelineName: 'StaticSiteBlueGreenPipeline',
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        },
        {
          stageName: 'DeployBlue',
          actions: [deployInfraAction, deployToBlueAction, invalidateBlueAction],
        },
        {
          stageName: 'DeployGreen',
          actions: [approveGreenDeploymentAction, deployToGreenAction, invalidateGreenAction],
        },
        {
          stageName: 'PromoteToGreen',
          actions: [approvePromoteToGreenAction, updateCloudFrontOriginAction, invalidatePostPromotionAction],
        },
      ],
    });
  }
}
