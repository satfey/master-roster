// src/routes/calculate.js

const express = require("express");
const multer = require("multer");

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage()
});

const { calculateSum } = require("../services/sumService");

/**
 * @swagger
 * /calculate/sum:
 *   post:
 *     summary: Calculate sum from uploaded file
 *     tags:
 *       - Calculate
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Sum calculated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sum:
 *                   type: number
 *                   example: 15
 */
router.post("/calculate/sum", upload.single("file"), (req, res) => {
    const text = req.file.buffer.toString("utf8");

    const sum = calculateSum(text);

    res.json({ sum });
});

module.exports = router;