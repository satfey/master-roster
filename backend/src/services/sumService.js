function calculateSum(text) {
    const numbers = text
        .split(/\r?\n/)
        .map(Number);

    return numbers.reduce((a, b) => a + b, 0);
}

module.exports = {
    calculateSum
};