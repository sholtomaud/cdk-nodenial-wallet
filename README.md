# Secure Static Website with AWS CDK, CI/CD Pipeline, and Blue/Green Deployments

This project deploys a static website using AWS CDK, hosted on S3 and distributed via CloudFront, with a custom domain managed by Route 53 and an ACM certificate for HTTPS. It includes AWS WAF for security and a full CI/CD pipeline using AWS CodePipeline for automated blue/green deployments.

## Architecture
- **Amazon S3**: Stores the static website content (HTML, CSS, JavaScript, images) in two separate "blue" and "green" buckets.
- **Amazon CloudFront**: Acts as a Content Delivery Network (CDN) to cache and serve website content globally. It's configured with an Origin Access Identity (OAI) to restrict direct access to the S3 buckets and can switch between blue and green origins.
- **AWS Certificate Manager (ACM)**: Provides an SSL/TLS certificate to enable HTTPS for the custom domain.
- **Amazon Route 53**: Manages the DNS for the custom domain, pointing it to the CloudFront distribution.
- **AWS WAF**: Provides a web application firewall to protect the CloudFront distribution against common web exploits and offers rate limiting.
- **AWS CodePipeline**: Automates the build and deployment process, orchestrating blue/green deployments.
- **AWS CodeBuild**: Used within the pipeline for building CDK assets, deploying to S3, and updating CloudFront.
- **AWS IAM**: Manages permissions for pipeline actions and CodeBuild projects.

## Pre-Merge Checks / GitHub Actions

To ensure code quality and adherence to best practices before merging changes into the `main` branch, this project uses GitHub Actions to perform automated checks on pull requests.

### Linting Workflow (`.github/workflows/lint.yml`)
- **Trigger:** Runs on pull requests targeting the `main` branch.
- **Description:** This workflow executes `npm run lint`, which uses ESLint and Prettier to check the codebase for style consistency and potential syntax errors.
- **Purpose:** To enforce a common code style, improve readability, and catch basic coding errors early in the development cycle.
- **Resolving Issues:** If this workflow fails, developers are expected to fix the linting errors reported by the action. The `lint` script in `package.json` (`eslint . --ext .js,.ts --fix && prettier --write '**/*.{js,ts,json,md,yml}'`) can often fix many issues automatically when run locally.

### CDK Nag Workflow (`.github/workflows/cdk-nag.yml`)
- **Trigger:** Runs on pull requests targeting the `main` branch.
- **Description:** This workflow first installs dependencies and then runs `npx cdk synth`. Because `cdk-nag` has been programmatically integrated into the CDK application (in `bin/app.ts` via `AwsSolutionsChecks`), the `cdk synth` command will now also execute `cdk-nag` scans. The workflow uses `npx cdk-nag --fail-on-warnings` in the `cdk-nag.yml` file, but the programmatic integration means the `cdk synth` step itself will fail if there are any `cdk-nag` rule violations that are not suppressed.
- **Purpose:** To automatically check the CDK application for adherence to AWS best practices, common security issues, and compliance with organizational guidelines using the `cdk-nag` tool.
- **Resolving Issues:** If this workflow fails due to `cdk-nag` findings:
    1.  **Fix the Issue:** The preferred method is to address the underlying issue in your CDK code according to the best practice highlighted by `cdk-nag`.
    2.  **Suppress the Finding:** If a finding is deemed acceptable for specific reasons (e.g., a deliberate design choice that has been reviewed), you can add a `NagSuppression`. Suppressions are managed centrally in `bin/app.ts`.
        Example of adding a suppression in `bin/app.ts`:
        ```typescript
        // In bin/app.ts, after stack instantiation
        NagSuppressions.addStackSuppressions(yourStackInstance, [
          { 
            id: 'AwsSolutions-XYZ', // The ID of the rule to suppress
            reason: 'A well-documented reason why this rule is being suppressed for this specific resource or context.' 
          },
        ]);
        ```
        You will need to identify the specific rule ID from the `cdk-nag` output and provide a clear justification for the suppression.

These automated checks help maintain code quality and infrastructure best practices throughout the project.

## CI/CD Pipeline Overview

The deployment of the static website is automated using an AWS CodePipeline, which implements a blue/green strategy.

**Pipeline Trigger:**
The pipeline is triggered by commits to the `main` branch (or as configured in `lib/pipeline-stack.ts`) of your GitHub repository, after all pre-merge checks (GitHub Actions) have passed.

**Pipeline Stages:**
1.  **Source:** Fetches the latest code from the specified GitHub repository and branch using an AWS CodeStar Connection.
    *   **Configuration Required:** You MUST update placeholder values for `GITHUB_OWNER`, `GITHUB_REPO`, and `CONNECTION_ARN` in `lib/pipeline-stack.ts` for this stage to function.
2.  **Build:**
    *   Installs dependencies (`npm ci`).
    *   Synthesizes the CDK application (`npx cdk synth`). This step will also run `cdk-nag` checks due to the programmatic integration.
    *   Prepares two artifacts:
        *   `CdkOutputArtifact`: Contains the CloudFormation templates generated by CDK.
        *   `SiteOutputArtifact`: Contains the static website files from the `site/` directory.
3.  **DeployBlue:**
    *   Deploys any infrastructure changes defined in `StaticSiteStack` (using `CdkOutputArtifact`).
    *   Deploys the new website version from `SiteOutputArtifact` to the **blue** S3 bucket.
    *   Invalidates the CloudFront cache for the blue environment paths.
4.  **DeployGreen:**
    *   **Manual Approval:** Waits for manual approval in the CodePipeline console before proceeding.
    *   Deploys the new website version from `SiteOutputArtifact` to the **green** S3 bucket.
    *   Invalidates the CloudFront cache for the green environment paths. (Note: At this point, the green environment is updated but not yet serving live traffic).
5.  **PromoteToGreen:**
    *   **Manual Approval:** Waits for manual approval to promote the green environment to live.
    *   Updates the CloudFront distribution's default behavior to point its origin to the **green** S3 bucket.
    *   Invalidates the CloudFront cache to ensure users get the latest content from the green environment.

## Blue/Green Deployment Strategy

This setup employs a blue/green deployment strategy to minimize downtime and risk when deploying new versions:

1.  **Two Identical Environments:** Two separate S3 buckets, "blue" (`blue-your.domain.com`) and "green" (`green-your.domain.com`), serve as identical hosting environments.
2.  **Staging Deployment:**
    *   Initially, CloudFront points to the **blue** S3 bucket as the live environment.
    *   New versions of the website are first deployed to the **blue** bucket (via the `DeployBlue` stage). This allows for testing the blue environment directly (e.g., by temporarily configuring a separate CloudFront behavior or using S3 website endpoints if enabled, though this pipeline focuses on CloudFront switching).
    *   After the `DeployBlue` stage, the same new version is deployed to the **green** S3 bucket (after manual approval in the `DeployGreen` stage). The green environment can then be tested thoroughly (e.g., via a test URL or by directly accessing green bucket content if configured for it, or by temporarily pointing a test CloudFront distribution or behavior).
3.  **Traffic Switching:**
    *   After the `DeployGreen` stage and a manual approval in the `PromoteToGreen` stage, the pipeline updates the CloudFront distribution to switch its origin from the blue S3 bucket to the green S3 bucket.
    *   This switch is near-instantaneous from CloudFront's perspective. Cache invalidation ensures users begin receiving content from the newly promoted green environment.
4.  **Manual Approvals:**
    *   **Deploy to Green:** A manual approval step is required before deploying the site content to the green S3 bucket. This allows for verification of the blue deployment or any other checks.
    *   **Promote Green to Live:** A second manual approval step is required before switching CloudFront to point to the green S3 bucket. This is the final gate before the new version goes live.

## How to Use/Interact with the Pipeline

**Prerequisites:**

1.  **AWS CDK Setup:** Ensure you have AWS CDK installed and configured.
2.  **AWS Account and Region:**
    *   Configure your AWS account and regions in `bin/app.ts`. The `StaticSiteStack` (including ACM certificate for CloudFront) is deployed to `us-east-1`. The `PipelineStack` can be deployed to your primary operational region (e.g., `us-east-2` or `CDK_DEFAULT_REGION`).
3.  **GitHub Repository:** Your static website code should be in a GitHub repository.
4.  **AWS CodeStar Connection:** Create an AWS CodeStar Connection to your GitHub account/organization. Note its ARN.
5.  **Update Pipeline Configuration:**
    Open `lib/pipeline-stack.ts` and update the following placeholder values in the `sourceAction` definition:
    *   `owner`: Your GitHub username or organization name.
    *   `repo`: The name of your GitHub repository.
    *   `connectionArn`: The ARN of the CodeStar Connection you created.
6.  **Domain and Subdomain (in `bin/app.ts`):**
    Open `bin/app.ts` and set:
    *   `domainName`: Your registered domain name (e.g., `example.com`).
    *   `siteSubDomain`: Your desired subdomain (e.g., `www`).
7.  **Route 53 Hosted Zone (via CDK Context for initial deployment):**
    If deploying for the first time or if CDK cannot automatically look up your hosted zone, you may need to provide `hostedZoneId` and `zoneName` as context parameters.
    *   `hostedZoneId`: The ID of your public hosted zone in Route 53.
    *   `zoneName`: The domain name of your hosted zone.
    You can set these in `cdk.json` or pass them via CLI:
    ```bash
    # Example for cdk.json
    # {
    #   "context": {
    #     "hostedZoneId": "YOUR_HOSTED_ZONE_ID_HERE",
    #     "zoneName": "your.domain.com"
    #   }
    # }
    ```

**Initial Deployment:**

To deploy both the `StaticSiteStack` (infrastructure) and the `PipelineStack` (CI/CD pipeline), run:
```bash
# Install dependencies
npm install

# Bootstrap AWS environment (once per account/region for CDK)
# Ensure both the StaticSiteStack region (e.g., us-east-1) and PipelineStack region are bootstrapped.
npx cdk bootstrap aws://ACCOUNT-ID/REGION # Replace ACCOUNT-ID and REGION for each region

# Deploy all stacks
npx cdk deploy --all --context hostedZoneId=YOUR_HOSTED_ZONE_ID --context zoneName=YOUR_ZONE_NAME
# The --context flags might only be needed for the very first deployment if not set in cdk.json
```
**Note:** The `wafRateLimit` is an optional parameter in `bin/app.ts` for the `StaticSiteStack` that defaults to `500` if not set. It's currently commented out in the provided `bin/app.ts`.

**Monitoring the Pipeline:**

1.  Navigate to the **AWS CodePipeline** console in your AWS account.
2.  Find the pipeline named `StaticSiteBlueGreenPipeline` (or as configured).
3.  You can view the progress of each stage, logs, and any errors.

**Manual Approvals:**

When the pipeline reaches a manual approval step:
1.  It will pause and show "Waiting for approval" in the CodePipeline console.
2.  Click on the "Review" button for the approval action.
3.  Review the details and then "Approve" or "Reject" the action.
    *   **ApproveGreenDeployment:** Approve to deploy the built site to the green S3 bucket.
    *   **ApprovePromoteToGreen:** Approve to switch CloudFront traffic to the green S3 bucket, making it live.

## Rollback Strategy

The blue/green setup provides a straightforward rollback mechanism:

1.  **Immediate Rollback (Manual CloudFront Update):** If the green environment (now live) shows issues, you can manually update the CloudFront distribution in the AWS console or via AWS CLI to point back to the `blueOrigin` (the S3 origin for the blue bucket). This would be the quickest way to revert. You would then need to invalidate the cache.
2.  **Pipeline Redeployment:** Deploy a previous, stable commit by manually triggering the pipeline for that commit or by reverting the problematic commit in your Git repository and pushing the change. The pipeline will then deploy this older version through the blue/green process.
3.  **No "PromoteToBlue" Stage:** The current pipeline does not have an automated "PromoteToBlue" stage. Adding such a stage would be an enhancement for a more automated rollback.

## Local Development/Testing

For static website content (HTML, CSS, JavaScript):
1.  Develop and test your website files locally in your preferred development environment.
2.  Most modern browsers allow you to open HTML files directly from your local file system to preview changes.
3.  Once you are satisfied with your changes, commit them to your Git repository and push to the `main` branch (or your designated trigger branch) to initiate the CI/CD pipeline.

## Security
This deployment includes AWS WAF with a default rate-limiting rule. See the "Testing AWS WAF Rate-Based Rule" section for details on how to test this. You can customize WAF rules further as needed.

**Recommendations for Ongoing Security Management:**
1.  **AWS Budgets**: Configure AWS Budgets to alert you on cost thresholds.
2.  **CloudWatch Alarms**: Monitor CloudFront (`Requests`, `BytesDownloaded`, `4xxErrorRate`, `5xxErrorRate`) and WAF (`BlockedRequests`) metrics.
3.  **Regularly Review Logs**: Enable and review CloudFront and WAF access logs.
4.  **CloudFront Geo-restrictions**: Consider if applicable.
5.  **Strong Cache-Control Headers**: While the pipeline handles invalidations, proper cache-control headers for assets are still a good practice.

## Testing AWS WAF Rate-Based Rule
The WAF is configured with a rate-based rule. The default `wafRateLimit` is 500 requests per 5-minute period per IP (if not overridden in `bin/app.ts`).

**Testing Steps:**
Use a tool like `curl` in a loop from a single IP:
```bash
# Replace YOUR_WEBSITE_URL (e.g., https://www.example.com)
# Send slightly more requests than your configured limit.
for i in {1..600}; do curl -s -o /dev/null -w "%{http_code}\n" YOUR_WEBSITE_URL; sleep 0.1; done
```
**Expected Outcome:**
Initially, `200` (OK) responses. After exceeding the rate limit, `403` (Forbidden) responses from CloudFront.

**Verification in AWS Console:**
1.  Navigate to **WAF & Shield** > **Web ACLs**.
2.  Select your Web ACL (e.g., `SiteWebACL`).
3.  View the **Overview** tab for graphs of allowed/blocked requests and the **Sampled requests** tab for details.
4.  Check associated CloudWatch metrics.

**Considerations:** Testing costs, authorization, timing, and consistent IP address for testing.
