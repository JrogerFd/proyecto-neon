#include "Simulation.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <limits>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>
#include <sys/resource.h>

#ifdef NEON_RUSH_HAS_MPI
#include "MpiSimulation.hpp"
#include <mpi.h>
#endif
#ifdef _OPENMP
#include <omp.h>
#endif

namespace {

constexpr std::size_t kMaximumProtocolBytes = 65536;
constexpr std::size_t kMaximumVehicles = 64;

struct Request {
  std::string mode;
  std::size_t steps = 0;
  double deltaTime = 0.0;
  int threads = 1;
  std::vector<neon_rush::Vehicle> vehicles;
};

struct Result {
  std::string mode;
  int processes = 1;
  int threads = 1;
  std::size_t steps = 0;
  double movementSeconds = 0.0;
  double collisionSeconds = 0.0;
  double communicationSeconds = 0.0;
  double totalSeconds = 0.0;
  double processCpuSeconds = 0.0;
  std::uint64_t processPeakRssBytes = 0;
  std::size_t collisions = 0;
  bool hasReference = false;
  double referenceTotalSeconds = 0.0;
  double speedup = 0.0;
  double efficiency = 0.0;
  std::vector<neon_rush::Vehicle> vehicles;
  std::vector<neon_rush::GlobalCollisionPair> pairs;
  std::vector<std::string> nodes;
};

struct ProcessUsage {
  double cpuSeconds = 0.0;
  std::uint64_t peakRssBytes = 0;
};

ProcessUsage readProcessUsage() {
  rusage usage{};
  if (getrusage(RUSAGE_SELF, &usage) != 0) {
    throw std::runtime_error("unable to read process resource usage");
  }
  const double userSeconds =
      static_cast<double>(usage.ru_utime.tv_sec) +
      static_cast<double>(usage.ru_utime.tv_usec) / 1'000'000.0;
  const double systemSeconds =
      static_cast<double>(usage.ru_stime.tv_sec) +
      static_cast<double>(usage.ru_stime.tv_usec) / 1'000'000.0;
  return {
      userSeconds + systemSeconds,
      static_cast<std::uint64_t>(usage.ru_maxrss) * 1024ULL};
}

std::string requiredToken(std::istream& input, const char* field) {
  std::string token;
  if (!(input >> token)) {
    throw std::invalid_argument(std::string("missing ") + field);
  }
  return token;
}

bool matchesReference(
    const neon_rush::Simulation& reference,
    const Result& parallel,
    const std::size_t collisions) {
  if (reference.state().collisionCount != collisions ||
      reference.vehicles().size() != parallel.vehicles.size() ||
      reference.lastCollisionPairs() != parallel.pairs) {
    return false;
  }
  std::unordered_map<std::size_t, const neon_rush::Vehicle*> actualById;
  actualById.reserve(parallel.vehicles.size());
  for (const auto& vehicle : parallel.vehicles) {
    actualById.emplace(vehicle.id, &vehicle);
  }
  for (const auto& expected : reference.vehicles()) {
    const auto found = actualById.find(expected.id);
    if (found == actualById.end()) {
      return false;
    }
    const auto& actual = *found->second;
    if (expected.x != actual.x || expected.z != actual.z ||
        expected.speed != actual.speed ||
        expected.direction != actual.direction ||
        expected.collisionRadius != actual.collisionRadius ||
        expected.active != actual.active) {
      return false;
    }
  }
  return true;
}

template <typename Integer>
Integer parseInteger(const std::string& value, const char* field) {
  Integer parsed{};
  const auto conversion = std::from_chars(
      value.data(), value.data() + value.size(), parsed);
  if (conversion.ec != std::errc{} ||
      conversion.ptr != value.data() + value.size()) {
    throw std::invalid_argument(std::string("invalid ") + field);
  }
  return parsed;
}

double parseNumber(const std::string& value, const char* field) {
  char* end = nullptr;
  const double parsed = std::strtod(value.c_str(), &end);
  if (end != value.c_str() + value.size() || !std::isfinite(parsed)) {
    throw std::invalid_argument(std::string("invalid ") + field);
  }
  return parsed;
}

Request parseRequest(const std::string& protocol) {
  if (protocol.size() > kMaximumProtocolBytes) {
    throw std::invalid_argument("request protocol is too large");
  }
  std::istringstream input(protocol);
  const auto version = requiredToken(input, "protocol version");
  if (version != "NRAPI1") {
    throw std::invalid_argument("unsupported request protocol");
  }

  Request request;
  request.mode = requiredToken(input, "mode");
  if (request.mode != "sequential" && request.mode != "openmp" &&
      request.mode != "mpi") {
    throw std::invalid_argument("unsupported execution mode");
  }
  const auto steps = parseInteger<std::uint32_t>(
      requiredToken(input, "step count"), "step count");
  request.steps = steps;
  request.deltaTime =
      parseNumber(requiredToken(input, "delta time"), "delta time");
  const auto count = parseInteger<std::uint32_t>(
      requiredToken(input, "vehicle count"), "vehicle count");
  request.threads = parseInteger<int>(
      requiredToken(input, "thread count"), "thread count");
  if (request.steps < 1 || request.steps > 120 ||
      request.deltaTime < 0.0 || request.deltaTime > 0.1 ||
      count > kMaximumVehicles || request.threads < 1 ||
      request.threads > 4) {
    throw std::invalid_argument("request settings are outside allowed bounds");
  }
  if (request.mode != "openmp" && request.threads != 1) {
    throw std::invalid_argument("threads are only valid for OpenMP mode");
  }

  request.vehicles.reserve(count);
  std::set<std::uint32_t> ids;
  for (std::uint32_t index = 0; index < count; ++index) {
    neon_rush::Vehicle vehicle;
    const auto id = parseInteger<std::uint32_t>(
        requiredToken(input, "vehicle id"), "vehicle id");
    vehicle.id = id;
    vehicle.x = parseNumber(
        requiredToken(input, "vehicle x"), "vehicle x");
    vehicle.z = parseNumber(
        requiredToken(input, "vehicle z"), "vehicle z");
    vehicle.speed = parseNumber(
        requiredToken(input, "vehicle speed"), "vehicle speed");
    vehicle.direction = parseNumber(
        requiredToken(input, "vehicle direction"), "vehicle direction");
    vehicle.collisionRadius = parseNumber(
        requiredToken(input, "collision radius"), "collision radius");
    const auto active = parseInteger<int>(
        requiredToken(input, "active flag"), "active flag");
    if (active != 0 && active != 1) {
      throw std::invalid_argument("active flag must be 0 or 1");
    }
    vehicle.active = active == 1;
    if (std::abs(vehicle.x) > 1.0e9 || std::abs(vehicle.z) > 1.0e9 ||
        vehicle.speed > 1.0e6 || vehicle.collisionRadius < 1.0e-4 ||
        vehicle.collisionRadius > 1.0e6) {
      throw std::invalid_argument("vehicle fields are outside safe bounds");
    }
    neon_rush::validateVehicle(vehicle);
    if (!ids.insert(id).second) {
      throw std::invalid_argument("vehicle ids must be unique");
    }
    request.vehicles.push_back(vehicle);
  }

  std::string extra;
  if (input >> extra) {
    throw std::invalid_argument("unexpected trailing request data");
  }
  return request;
}

void printResult(const Result& result) {
  std::cout << std::setprecision(17)
            << "NRAPI1 " << result.mode << ' ' << result.processes << ' '
            << result.threads << ' ' << result.steps << ' '
            << result.movementSeconds << ' ' << result.collisionSeconds
            << ' ' << result.communicationSeconds << ' '
            << result.totalSeconds << ' ' << result.collisions << ' '
            << result.processCpuSeconds << ' '
            << result.processPeakRssBytes << ' '
            << result.vehicles.size() << ' ' << result.pairs.size() << ' '
            << result.nodes.size() << ' ' << (result.hasReference ? 1 : 0)
            << ' ' << result.referenceTotalSeconds << ' '
            << result.speedup << ' ' << result.efficiency << '\n';
  for (const auto& vehicle : result.vehicles) {
    std::cout << "V " << vehicle.id << ' ' << vehicle.x << ' '
              << vehicle.z << ' ' << vehicle.speed << ' '
              << vehicle.direction << ' ' << vehicle.collisionRadius
              << ' ' << (vehicle.active ? 1 : 0) << '\n';
  }
  for (const auto& pair : result.pairs) {
    std::cout << "P " << pair.firstId << ' ' << pair.secondId << '\n';
  }
  for (const auto& node : result.nodes) {
    std::cout << "N " << node << '\n';
  }
  std::cout << "END\n";
}

int parseModeArgument(const int argc, char** argv) {
  if (argc != 3 || std::string_view(argv[1]) != "--mode") {
    throw std::invalid_argument("expected --mode MODE");
  }
  const std::string_view mode(argv[2]);
  if (mode == "sequential") return 0;
  if (mode == "openmp") return 1;
  if (mode == "mpi") return 2;
  throw std::invalid_argument("unsupported execution mode");
}

std::string readBoundedStdin() {
  std::string content;
  content.reserve(kMaximumProtocolBytes);
  char character = 0;
  while (std::cin.get(character)) {
    if (content.size() == kMaximumProtocolBytes) {
      throw std::invalid_argument("request protocol is too large");
    }
    content.push_back(character);
  }
  if (!std::cin.eof()) {
    throw std::runtime_error("failed to read request protocol");
  }
  return content;
}

#ifdef NEON_RUSH_HAS_MPI
std::string broadcastProtocol(const int rank) {
  int valid = 1;
  std::string protocol;
  if (rank == 0) {
    try {
      protocol = readBoundedStdin();
    } catch (const std::exception&) {
      valid = 0;
    }
  }
  MPI_Bcast(&valid, 1, MPI_INT, 0, MPI_COMM_WORLD);
  if (valid == 0) {
    throw std::invalid_argument("unable to read bounded request from stdin");
  }
  std::uint64_t size = rank == 0
      ? static_cast<std::uint64_t>(protocol.size())
      : 0;
  MPI_Bcast(&size, 1, MPI_UINT64_T, 0, MPI_COMM_WORLD);
  if (size > kMaximumProtocolBytes) {
    throw std::invalid_argument("request protocol is too large");
  }
  if (rank != 0) {
    protocol.resize(static_cast<std::size_t>(size));
  }
  MPI_Bcast(protocol.data(), static_cast<int>(size), MPI_CHAR, 0,
            MPI_COMM_WORLD);
  return protocol;
}

std::vector<std::string> gatherNodes(const int rank,
                                     const int processCount) {
  char localName[MPI_MAX_PROCESSOR_NAME]{};
  int localLength = 0;
  MPI_Get_processor_name(localName, &localLength);
  std::vector<char> names;
  std::vector<int> lengths;
  if (rank == 0) {
    names.resize(static_cast<std::size_t>(processCount) *
                 MPI_MAX_PROCESSOR_NAME);
    lengths.resize(static_cast<std::size_t>(processCount));
  }
  MPI_Gather(localName, MPI_MAX_PROCESSOR_NAME, MPI_CHAR,
             rank == 0 ? names.data() : nullptr,
             MPI_MAX_PROCESSOR_NAME, MPI_CHAR, 0, MPI_COMM_WORLD);
  MPI_Gather(&localLength, 1, MPI_INT,
             rank == 0 ? lengths.data() : nullptr,
             1, MPI_INT, 0, MPI_COMM_WORLD);
  std::vector<std::string> result;
  if (rank == 0) {
    result.reserve(static_cast<std::size_t>(processCount));
    for (int process = 0; process < processCount; ++process) {
      const auto offset = static_cast<std::size_t>(process) *
                          MPI_MAX_PROCESSOR_NAME;
      result.emplace_back(
          names.data() + offset,
          static_cast<std::size_t>(lengths[static_cast<std::size_t>(process)]));
    }
  }
  return result;
}
#endif

}  // namespace

int main(int argc, char** argv) {
  int requestedMode = -1;
  try {
    requestedMode = parseModeArgument(argc, argv);
  } catch (const std::exception& error) {
    std::cerr << "neon_rush_api: " << error.what() << '\n';
    return EXIT_FAILURE;
  }

#ifdef NEON_RUSH_HAS_MPI
  MPI_Init(&argc, &argv);
  int rank = 0;
  int processCount = 1;
  MPI_Comm_rank(MPI_COMM_WORLD, &rank);
  MPI_Comm_size(MPI_COMM_WORLD, &processCount);
#else
  constexpr int rank = 0;
  constexpr int processCount = 1;
  if (requestedMode == 2) {
    std::cerr << "neon_rush_api: MPI support is unavailable\n";
    return EXIT_FAILURE;
  }
#endif

  int exitCode = EXIT_SUCCESS;
  try {
    if (requestedMode == 2) {
#ifdef NEON_RUSH_HAS_MPI
      if (processCount < 1 || processCount > 3) {
        throw std::invalid_argument("MPI process count must be 1..3");
      }
      const auto protocol = broadcastProtocol(rank);
      const auto request = parseRequest(protocol);
      if (request.mode != "mpi") {
        throw std::invalid_argument("request mode does not match MPI runner");
      }
      const double mpiTotalStart = MPI_Wtime();
      const auto processUsageStart = readProcessUsage();
      auto simulation = neon_rush::MpiSimulation(
          rank == 0 ? request.vehicles : std::vector<neon_rush::Vehicle>{},
          request.vehicles.size(), MPI_COMM_WORLD);
      simulation.run(request.steps, request.deltaTime);
      Result result;
      result.mode = "mpi";
      result.processes = processCount;
      result.threads = 1;
      result.steps = request.steps;
      result.movementSeconds =
          simulation.state().vehicleUpdateSeconds;
      result.collisionSeconds =
          simulation.state().collisionDetectionSeconds;
      result.communicationSeconds =
          simulation.state().communicationSeconds;
      result.collisions = simulation.state().collisionCount;
      result.vehicles = simulation.gatherVehicles();
      result.pairs = simulation.gatherLastCollisionPairs();
      result.nodes = gatherNodes(rank, processCount);
      const double localMpiTotal = MPI_Wtime() - mpiTotalStart;
      double slowestMpiTotal = 0.0;
      MPI_Reduce(&localMpiTotal, &slowestMpiTotal, 1, MPI_DOUBLE,
                 MPI_MAX, 0, MPI_COMM_WORLD);
      result.totalSeconds = slowestMpiTotal;
      const auto processUsageEnd = readProcessUsage();
      const double localCpuSeconds =
          processUsageEnd.cpuSeconds - processUsageStart.cpuSeconds;
      const std::uint64_t localPeakRssBytes =
          processUsageEnd.peakRssBytes;
      double maximumCpuSeconds = 0.0;
      std::uint64_t maximumPeakRssBytes = 0;
      MPI_Reduce(&localCpuSeconds, &maximumCpuSeconds, 1, MPI_DOUBLE,
                 MPI_MAX, 0, MPI_COMM_WORLD);
      MPI_Reduce(&localPeakRssBytes, &maximumPeakRssBytes, 1,
                 MPI_UINT64_T, MPI_MAX, 0, MPI_COMM_WORLD);
      if (rank == 0) {
        result.processCpuSeconds = maximumCpuSeconds;
        result.processPeakRssBytes = maximumPeakRssBytes;
      }
      Result referenceResult;
      int referenceMatches = 1;
      if (rank == 0) {
        const auto referenceStart = std::chrono::steady_clock::now();
        neon_rush::Simulation reference(
            request.vehicles, neon_rush::ExecutionMode::Sequential, 1);
        reference.run(request.steps, request.deltaTime);
        const auto referenceFinish = std::chrono::steady_clock::now();
        referenceResult.hasReference = true;
        referenceResult.referenceTotalSeconds =
            std::chrono::duration<double>(
                referenceFinish - referenceStart).count();
        referenceResult.speedup =
            result.totalSeconds > 0.0
                ? referenceResult.referenceTotalSeconds / result.totalSeconds
                : 0.0;
        referenceResult.efficiency =
            referenceResult.speedup / processCount;
        referenceMatches = matchesReference(
            reference, result, result.collisions) ? 1 : 0;
      }
      MPI_Bcast(&referenceMatches, 1, MPI_INT, 0, MPI_COMM_WORLD);
      if (referenceMatches == 0) {
        throw std::runtime_error(
            "MPI state or last-step collision pairs differ from sequential");
      }
      if (rank == 0) {
        result.hasReference = referenceResult.hasReference;
        result.referenceTotalSeconds =
            referenceResult.referenceTotalSeconds;
        result.speedup = referenceResult.speedup;
        result.efficiency = referenceResult.efficiency;
        printResult(result);
      }
#endif
    } else {
      const auto protocol = readBoundedStdin();
      const auto request = parseRequest(protocol);
      const auto expectedMode =
          requestedMode == 0 ? "sequential" : "openmp";
      if (request.mode != expectedMode) {
        throw std::invalid_argument("request mode does not match runner");
      }
      if (requestedMode == 1 && !neon_rush::openMPSupported()) {
        throw std::runtime_error("OpenMP support is unavailable");
      }
#ifdef _OPENMP
      if (requestedMode == 1) {
        omp_set_dynamic(0);
      }
#endif
      const auto start = std::chrono::steady_clock::now();
      const auto processUsageStart = readProcessUsage();
      neon_rush::Simulation simulation(
          request.vehicles,
          requestedMode == 0
              ? neon_rush::ExecutionMode::Sequential
              : neon_rush::ExecutionMode::OpenMP,
          requestedMode == 0 ? 1 : request.threads);
      simulation.run(request.steps, request.deltaTime);
      const auto finish = std::chrono::steady_clock::now();
      const auto processUsageEnd = readProcessUsage();
      Result result;
      result.mode = request.mode;
      result.processes = 1;
      result.threads = requestedMode == 0 ? 1 : request.threads;
      result.steps = request.steps;
      result.movementSeconds =
          simulation.state().vehicleUpdateSeconds;
      result.collisionSeconds =
          simulation.state().collisionDetectionSeconds;
      result.totalSeconds =
          std::chrono::duration<double>(finish - start).count();
      result.processCpuSeconds =
          processUsageEnd.cpuSeconds - processUsageStart.cpuSeconds;
      result.processPeakRssBytes = processUsageEnd.peakRssBytes;
      result.collisions = simulation.state().collisionCount;
      result.vehicles = simulation.vehicles();
      result.pairs = simulation.lastCollisionPairs();
      if (requestedMode == 1) {
        const auto referenceStart = std::chrono::steady_clock::now();
        neon_rush::Simulation reference(
            request.vehicles, neon_rush::ExecutionMode::Sequential, 1);
        reference.run(request.steps, request.deltaTime);
        const auto referenceFinish = std::chrono::steady_clock::now();
        if (!matchesReference(reference, result, result.collisions)) {
          throw std::runtime_error(
              "OpenMP state or last-step collision pairs differ from sequential");
        }
        result.hasReference = true;
        result.referenceTotalSeconds =
            std::chrono::duration<double>(
                referenceFinish - referenceStart).count();
        result.speedup =
            result.totalSeconds > 0.0
                ? result.referenceTotalSeconds / result.totalSeconds
                : 0.0;
        result.efficiency = result.speedup / result.threads;
      }
      printResult(result);
    }
  } catch (const std::exception& error) {
    if (rank == 0) {
      std::cerr << "neon_rush_api: " << error.what() << '\n';
    }
    exitCode = EXIT_FAILURE;
  }

#ifdef NEON_RUSH_HAS_MPI
  MPI_Finalize();
#endif
  return exitCode;
}
