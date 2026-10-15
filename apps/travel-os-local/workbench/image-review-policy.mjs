// The user's explicit project-wide image confirmation is an authorization,
// not a claim that an agent visually inspected every image.
export const DEFAULT_IMAGE_REVIEW_POLICY=Object.freeze({
 enabled:true,
 version:'20261015-user-batch-confirmation',
 scope:'ALL_REGISTERED_SHOPS',
 confirmedBy:'用户',
 source:'2026-10-15用户明确要求图片默认批量确认，无逐图审核步骤',
 method:'user-batch-confirmation',
 observedText:'用户批量确认，未逐图目视审核',
 preserveExistingDecisions:true,
 verifyMainFileHashes:true
});
