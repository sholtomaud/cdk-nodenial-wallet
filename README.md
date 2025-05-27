# Secure Static Website with AWS CDK (No WAF)

This project deploys a static website using AWS CDK, hosted on S3 and distributed via CloudFront, with a custom domain managed by Route 53 and an ACM certificate for HTTPS. This version **does not** include AWS WAF for cost considerations.

## Architecture
- **Amazon S3**: Stores the static website content (HTML, CSS, JavaScript, images).
- **Amazon CloudFront**: Acts as a Content Delivery Network (CDN) to cache and serve website content globally, improving performance and reducing latency. It's configured with an Origin Access Identity (OAI) to restrict direct access to the S3 bucket.
- **AWS Certificate Manager (ACM)**: Provides an SSL/TLS certificate to enable HTTPS for the custom domain.
- **Amazon Route 53**: Manages the DNS for the custom domain, pointing it to the CloudFront distribution.

## Security Considerations (Denial of Wallet without AWS WAF)

Deploying a static website on AWS S3 and CloudFront provides a good baseline of security and availability. However, without AWS WAF, there are specific considerations regarding "Denial of Wallet" (DoW) attacks, where an attacker attempts to generate excessive costs.

**Mitigations in Place:**
- **Origin Access Identity (OAI)**: CloudFront uses an OAI to access the S3 bucket. This prevents direct public access to the S3 bucket, ensuring that all traffic must go through CloudFront. This protects your S3 costs from direct hits.
- **AWS Shield Standard**: Your AWS account automatically benefits from AWS Shield Standard. This service provides protection against many common network and transport layer DDoS attacks (e.g., SYN floods, UDP reflection attacks) that target your CloudFront distribution. There is no additional charge for Shield Standard.
- **CloudFront Caching**: By caching your static content at Edge Locations, CloudFront reduces the number of requests to your S3 origin, which can help mitigate costs from certain types of traffic.

**Limitations and Risks without AWS WAF:**
- **No Application-Layer Filtering**: AWS WAF provides rules to inspect web requests for malicious patterns (like XSS, SQL injection - though SQLi is less relevant for static sites) and filter them out. Without WAF, you are more exposed to application-layer attacks if your frontend code has vulnerabilities or interacts with other APIs.
- **Vulnerability to Sophisticated Bots and Targeted Attacks**: While Shield Standard handles large-scale DDoS, more sophisticated bots or targeted attacks designed to generate high request volumes (even if the requests are for valid content) can still lead to increased CloudFront data transfer and request costs. WAF's rate-based rules and managed rule sets (like Amazon IP Reputation List) are specifically designed to counter these.
- **Higher Risk of Bill Shock**: Without the granular request inspection and blocking capabilities of WAF, there's a higher inherent risk that unexpected traffic spikes (malicious or not) could lead to a surprisingly high AWS bill.

**Recommendations to Further Mitigate DoW Risks:**
1.  **AWS Budgets**: Configure AWS Budgets to alert you when your costs exceed predefined thresholds. This won't stop an attack but will provide early notification of unusual spending.
2.  **CloudWatch Alarms**:
    - Set alarms on key CloudFront metrics:
        - `Requests`: Monitor for unusual spikes in the number of requests.
        - `BytesDownloaded`: Track data transfer out, a primary cost driver.
        - `4xxErrorRate` and `5xxErrorRate`: Spikes can indicate attack attempts or issues.
    - Set alarms on S3 bucket metrics like `GetRequests` (though most should come via CloudFront).
3.  **Regularly Review Logs**:
    - Enable and periodically review CloudFront access logs. Store them in a separate S3 bucket.
    - Enable and review S3 server access logs if needed, though CloudFront logs are usually more relevant for traffic analysis.
4.  **CloudFront Geo-restrictions**: If your website targets a specific geographic audience, configure CloudFront geo-restrictions to block traffic from other regions known for malicious activity.
5.  **Implement Strong Cache-Control Headers**: Ensure your static assets have appropriate `Cache-Control` headers to maximize caching by browsers and CloudFront, reducing origin fetches.

## Deployment

**Configuration:**

The stack's behavior is primarily configured through properties in `bin/app.ts` and CDK context values (either in `cdk.json` or via CLI flags).

1.  **Domain and Subdomain (in `bin/app.ts`):**
    Open `bin/app.ts` and set:
    - `domainName`: Your registered domain name (e.g., `example.com`). This is used for creating resource names, the S3 bucket, the ACM certificate, and as a fallback for the Route 53 zone name.
    - `siteSubDomain`: Your desired subdomain (e.g., `www`). For a root domain setup (e.g., `example.com` directly), you might set this to an empty string (`''`) and ensure your S3 bucket naming and CloudFront CNAMEs are adjusted accordingly if needed (though the current setup primarily targets a subdomain like `www.example.com`).

2.  **Route 53 Hosted Zone (via CDK Context):**
    The `hostedZoneId` and `zoneName` for Route 53 are configured via CDK context. This is ideal for CI/CD.
    - **`hostedZoneId`**: The ID of your public hosted zone in Route 53 (e.g., `Z0123456789ABCDEFGHIJ`).
    - **`zoneName`**: The domain name of your hosted zone (e.g., `example.com`).

    You can set these in `cdk.json` under the `context` key:
    ```json
    // cdk.json
    {
      "app": "...",
      "context": {
        // ... other context variables
        "hostedZoneId": "YOUR_HOSTED_ZONE_ID_HERE",
        "zoneName": "your.domain.com"
      }
    }
    ```
    Alternatively, pass them via CLI flags (these override `cdk.json` values):
    ```bash
    cdk deploy --context hostedZoneId=YOUR_HOSTED_ZONE_ID --context zoneName=YOUR_ZONE_NAME
    ```
    If not provided, the stack uses fallback placeholders defined in `lib/static-site-stack.ts` (`Z0123456789ABCDEFGHIJ` for `hostedZoneId` and `props.domainName` for `zoneName`). **Providing your actual `hostedZoneId` is crucial for successful deployment.**

3.  **AWS Account and Region (in `bin/app.ts`):**
    Configure the target AWS account and region in `bin/app.ts`:
    ```typescript
    // bin/app.ts
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT || 'YOUR_ACCOUNT_ID', // Or your specific account
      region: process.env.CDK_DEFAULT_REGION || 'YOUR_REGION',   // Or your specific region
    },
    ```

**Deployment Commands:**
```bash
# Install dependencies
npm install

# Bootstrap AWS environment (once per account/region)
# Ensure us-east-1 is also bootstrapped if deploying the certificate there and it's different from your main stack region.
npx cdk bootstrap aws://ACCOUNT-ID/REGION # Replace ACCOUNT-ID and REGION

# Synthesize (optional, deploy does it too)
# Values from cdk.json are used by default if not overridden by --context
npx cdk synth 
# Or with CLI context:
# npx cdk synth --context hostedZoneId=YOUR_HOSTED_ZONE_ID --context zoneName=YOUR_ZONE_NAME

# Deploy the stack
# Values from cdk.json are used by default if not overridden by --context
npx cdk deploy
# Or with CLI context:
# npx cdk deploy --context hostedZoneId=YOUR_HOSTED_ZONE_ID --context zoneName=YOUR_ZONE_NAME
```

**Important Notes:**
- The ACM certificate for CloudFront must be in `us-east-1`. The stack handles this.
- Ensure your domain's NS records at your registrar point to the Route 53 name servers for the specified hosted zone.
- DNS validation for ACM will attempt to create CNAME records in your Route 53 hosted zone.

## CI/CD Pipeline for Content Updates

Automating the deployment of your website content (HTML, CSS, JS, images) is highly recommended. Here's a typical workflow:

1.  **Trigger**:
    - A code push to a specific branch (e.g., `main`, `master`, or `prod`) in your Git repository (e.g., GitHub, AWS CodeCommit, GitLab).

2.  **Build (Optional)**:
    - If you're using a static site generator (SSG) like Hugo, Jekyll, Next.js (static export), Gatsby, etc., this step involves running the build command (e.g., `npm run build`, `hugo`) to compile your site into static files (typically in a `public/`, `dist/`, or `_site/` folder).
    - For plain HTML/CSS/JS sites, this step might include linting, minification, or other asset optimization.

3.  **Deploy to S3**:
    - Synchronize your static files to the S3 website bucket. The bucket name is derived from `siteSubDomain` and `domainName` (e.g., `www.your.domain.com`).
    - Use the AWS CLI `s3 sync` command. The `--delete` flag is crucial as it removes files from S3 that are no longer in your source folder, ensuring a clean deployment.
      ```bash
      aws s3 sync ./your-public-folder/ s3://your-bucket-name --delete
      # Replace ./your-public-folder/ with the actual path to your built static files.
      # Replace your-bucket-name with the S3 bucket name (e.g., www.example.com).
      ```

4.  **CloudFront Invalidation**:
    - After successfully syncing files to S3, you need to tell CloudFront to fetch the updated content from the origin (S3). This is done by creating an invalidation.
    - The CloudFront Distribution ID is an output of the `cdk deploy` command (or can be found in the AWS Console).
      ```bash
      aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
      # Replace YOUR_DISTRIBUTION_ID with your actual CloudFront distribution ID.
      ```

**Cache-Busting Filenames:**

- **Technique**: This involves embedding a hash of the file's content into its name (e.g., `main.a1b2c3d4.css`, `bundle.x7y8z9w0.js`). When a file's content changes, its name (and hash) changes.
- **Benefits**:
    - Users receive the latest versions immediately because their browsers will request a new file (due to the changed name).
    - Avoids reliance on CloudFront cache expiry or waiting for invalidation propagation.
    - Allows for very long cache times (e.g., `Cache-Control: public, max-age=31536000, immutable`) for versioned assets, improving performance.
    - Your main `index.html` file should have a short cache time or `Cache-Control: no-cache` to ensure it always references the latest hashed assets.
- **Implementation**: Most modern static site generators and build tools (like Webpack, Rollup, Parcel) handle this automatically.

**Role of CloudFront Invalidations:**

- **Purpose**: Invalidations instruct CloudFront to mark cached objects at its edge locations as "expired." The next time a user requests an invalidated object, CloudFront fetches the latest version from the S3 origin.
- **`/*` Invalidation**: Invalidating all paths with `/*` is a blanket approach. It's simple but can be costly if you have many objects and update frequently, as AWS charges for invalidation paths (though there's a monthly free tier).
- **Specific Path Invalidations**: If you know which files have changed, you can invalidate only those specific paths (e.g., `/css/style.css`, `/js/main.js`). This is more cost-effective.
- **Propagation Delay**: Even after an invalidation is created, it takes some time (typically a few minutes) for it to propagate across all CloudFront edge locations. Cache-busting filenames are a more robust solution for immediate updates.

**Automation Tools:**

This entire CI/CD pipeline can be automated using services like:
- **GitHub Actions**
- **AWS CodePipeline** (integrates well with AWS CodeCommit, CodeBuild, S3, etc.)
- **GitLab CI/CD**
- **Jenkins**, and others.

These tools can listen for Git pushes, run build commands, execute S3 sync, and trigger CloudFront invalidations automatically.
